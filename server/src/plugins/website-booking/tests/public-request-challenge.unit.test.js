require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rules 1-5b and the transition edge case — the proof of
// work in front of POST /public/v1/booking-requests: a signed challenge, one hash to check it, spent
// once, never sooner than 3 s after it was issued; a difficulty that grows per address and slightly
// under a flood, capped; enforced only once the site's plugin reported a version that solves it.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_REQUEST_CHALLENGE_SECRET = 'test-secret';
const db = require('../../../database');
const challenge = require('../challenge');
const store = require('../requestStore');
const settings = require('../settings');

let lastSeen = '';
settings.termsSettings = () => ({ requireTermsAcceptance: false, lastSeenPluginVersion: lastSeen });
settings.recordPluginVersion = (v) => { lastSeen = v; };
const proof = require('../controllers/publicChallengeController');

const SECRET = 'test-secret';
const T0 = Date.parse('2027-03-01T10:00:00Z');

function res() {
  return {
    statusCode: 200, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
  };
}
const visitor = (ip, pluginVersion = '') => ({ ip, userAgent: 'test', pluginVersion });
function reset() {
  db.exec('DELETE FROM public_request_log; DELETE FROM public_request_challenges_used;');
}
store.ensureTables();

// ── rules 1, 3, 5 — the challenge itself ─────────────────────────────────────────────────────────

test('rule 1: a challenge is signed over every field; a solved one verifies with one hash', () => {
  const c = challenge.issue({ secret: SECRET, ipKey: '81.250.12.4', difficulty: 8, now: T0 });
  assert.deepEqual(Object.keys(c).sort(), ['challengeId', 'difficulty', 'expiresAt', 'issuedAt', 'salt', 'signature']);
  assert.equal(Date.parse(c.expiresAt) - Date.parse(c.issuedAt), 15 * 60 * 1000);
  const nonce = challenge.solve(c);
  assert.deepEqual(challenge.verify({ secret: SECRET, challenge: c, nonce, ipKey: '81.250.12.4', now: T0 + 5000 }),
    { ok: true, challengeId: c.challengeId, expiresAt: c.expiresAt });
});

test('rule 3: forged, expired, wrong or missing proofs are refused; rule 5: too fast too', () => {
  const c = challenge.issue({ secret: SECRET, ipKey: '81.250.12.4', difficulty: 8, now: T0 });
  const nonce = challenge.solve(c);
  const check = (over, extra = {}) => challenge.verify({ secret: SECRET, challenge: { ...c, ...over }, nonce, ipKey: '81.250.12.4', now: T0 + 5000, ...extra }).reason;
  assert.equal(check({ difficulty: 0 }), 'forged', 'an easier difficulty breaks the signature');
  assert.equal(check({ issuedAt: new Date(T0 - 60000).toISOString() }), 'forged');
  assert.equal(check({}, { secret: 'another' }), 'forged');
  assert.equal(check({}, { ipKey: '90.12.77.31' }), 'forged', 'a challenge is spent from the address it was issued to');
  assert.equal(check({}, { now: T0 + 15 * 60 * 1000 + 1 }), 'expired');
  assert.equal(check({}, { now: T0 + 2999 }), 'tooFast');
  assert.equal(challenge.verify({ secret: SECRET, challenge: c, nonce: 'zz-not-a-nonce', ipKey: '81.250.12.4', now: T0 + 5000 }).reason, 'wrong');
  let wrong = 0;
  while (challenge.leadingZeroBits(require('crypto').createHash('sha256').update(c.salt + wrong.toString(36)).digest()) >= 8) wrong += 1;
  assert.equal(challenge.verify({ secret: SECRET, challenge: c, nonce: wrong.toString(36), ipKey: '81.250.12.4', now: T0 + 5000 }).reason, 'wrong');
  assert.equal(challenge.verify({ secret: SECRET, challenge: c, nonce: '', ipKey: '81.250.12.4', now: T0 + 5000 }).reason, 'missing');
  assert.equal(challenge.verify({ secret: SECRET, challenge: null, nonce, ipKey: '81.250.12.4', now: T0 + 5000 }).reason, 'missing');
});

test('rule 3: a challenge is spent once, and forgotten after it expires', () => {
  reset();
  assert.equal(store.spendChallenge('abc', new Date(T0 + 1000).toISOString(), { now: T0 }), true);
  assert.equal(store.spendChallenge('abc', new Date(T0 + 1000).toISOString(), { now: T0 }), false);
  store.spendChallenge('other', new Date(T0 + 9e6).toISOString(), { now: T0 + 2000 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_request_challenges_used WHERE challengeId = 'abc'").get().n, 0);
});

// ── rules 4, 5b — the difficulty ─────────────────────────────────────────────────────────────────

test('rule 4: +2 bits per request from the same address in the hour; another address is not affected', () => {
  assert.equal(challenge.difficultyFor({ addressRequestsLastHour: 0, requestsLastHour: 0 }), 12);
  assert.equal(challenge.difficultyFor({ addressRequestsLastHour: 3, requestsLastHour: 3 }), 18);
  assert.equal(challenge.ipKeyOf('2a01:cb00:1:2:3:4:5:6'), challenge.ipKeyOf('2a01:cb00:1:2:ffff::1'), 'an IPv6 counts by its /64');
  assert.notEqual(challenge.ipKeyOf('2a01:cb00:1:2::1'), challenge.ipKeyOf('2a01:cb00:1:3::1'));
  assert.equal(challenge.ipKeyOf('::ffff:81.250.12.4'), '81.250.12.4');

  reset();
  const issued = (ip) => {
    const r = res();
    proof.issueChallenge({ visitor: visitor(ip), body: {}, query: {} }, r);
    assert.equal(r.headers['cache-control'], 'no-store');
    return r.body.data.difficulty;
  };
  assert.equal(issued('81.250.12.4'), 12);
  store.logRequest('81.250.12.4');
  store.logRequest('81.250.12.4');
  assert.equal(issued('81.250.12.4'), 16);
  assert.equal(issued('90.12.77.31'), 12, 'a guest on another address never pays for it');
});

test('rule 5b: more than 20 requests in the hour raise the base by 2 bits per further 20, capped at +6', () => {
  assert.deepEqual([0, 20, 21, 40, 41, 60, 61, 500].map(challenge.surgeBits), [0, 0, 2, 2, 4, 4, 6, 6]);
  assert.equal(challenge.difficultyFor({ addressRequestsLastHour: 0, requestsLastHour: 48 }), 16);
  assert.equal(challenge.difficultyFor({ addressRequestsLastHour: 10, requestsLastHour: 500 }), challenge.MAX_BITS, 'never more than the cap');
});

// ── the check in front of the request, and the transition ───────────────────────────────────────

function post(body, ip = '81.250.12.4') {
  const r = res();
  let passed = false;
  proof.requireProof({ body, visitor: visitor(ip), query: {}, headers: {} }, r, () => { passed = true; });
  return { passed, r };
}

test('edge case: before the site reported a plugin that solves challenges, a request without proof passes', () => {
  reset();
  lastSeen = '1.17.1';
  assert.equal(post({}).passed, true);
  assert.equal(store.countRecent({ ipKey: '81.250.12.4' }), 1, 'and still counts for the address');
});

test('edge case: once it has, a request without proof is refused with « Le formulaire doit être mis à jour »', () => {
  reset();
  lastSeen = '';
  const r = res();
  proof.issueChallenge({ visitor: visitor('81.250.12.4', '1.18.0'), body: {}, query: {} }, r);
  assert.equal(lastSeen, '1.18.0', 'the challenge read reports the version');
  assert.equal(proof.proofEnforced(), true);
  const refused = post({});
  assert.equal(refused.passed, false);
  assert.equal(refused.r.statusCode, 403);
  assert.equal(refused.r.body.error.code, 'CHALLENGE_INVALID');
  assert.match(refused.r.body.error.message, /Le formulaire doit être mis à jour/);
});

test('rules 3 + 5: a solved challenge passes once, then is refused; a forged one is refused', async () => {
  reset();
  lastSeen = '1.18.0';
  const issued = res();
  proof.issueChallenge({ visitor: visitor('81.250.12.4'), body: {}, query: {} }, issued);
  const c = issued.body.data;
  const nonce = challenge.solve(c);

  const tooFast = post({ challenge: c, nonce });
  assert.equal(tooFast.r.statusCode, 403);
  assert.equal(tooFast.r.body.error.details[0].issue, 'tooFast');

  await new Promise((resolve) => { setTimeout(resolve, 3100); });
  const ok = post({ challenge: c, nonce });
  assert.equal(ok.passed, true);
  const again = post({ challenge: c, nonce });
  assert.equal(again.passed, false);
  assert.equal(again.r.body.error.details[0].issue, 'used');
  const forged = post({ challenge: { ...c, difficulty: 1 }, nonce });
  assert.equal(forged.r.body.error.details[0].issue, 'forged');
  assert.equal(store.countRecent({ ipKey: '81.250.12.4' }), 1, 'only the accepted one is logged');
});

test('versionAtLeast reads semver, not text', () => {
  assert.equal(proof.versionAtLeast('1.18.0', '1.18.0'), true);
  assert.equal(proof.versionAtLeast('1.20.1', '1.18.0'), true);
  assert.equal(proof.versionAtLeast('1.9.9', '1.18.0'), false);
  assert.equal(proof.versionAtLeast('', '1.18.0'), false);
});

// ── review of PR #805 — rules 23 (prefetched challenges) and 24 (sticky enforcement) ────────────

test('rule 23: challenges fetched ahead raise the next one — the fiftieth is not cheap', () => {
  reset();
  db.exec('DELETE FROM public_request_issued');
  const difficulties = [];
  for (let i = 0; i < 6; i += 1) {
    const r = res();
    proof.issueChallenge({ visitor: visitor('203.0.113.7'), body: {}, query: {} }, r);
    difficulties.push(r.body.data.difficulty);
  }
  assert.deepEqual(difficulties, [12, 14, 16, 18, 20, 22]);
});

test('rule 23: a challenge issued before a flood, or before the address spent others, is refused as too easy', async () => {
  reset();
  db.exec('DELETE FROM public_request_issued');
  lastSeen = '1.18.0';
  const cheap = res();
  proof.issueChallenge({ visitor: visitor('203.0.113.8'), body: {}, query: {} }, cheap);
  const c = cheap.body.data;
  assert.equal(c.difficulty, 12);
  const nonce = challenge.solve(c);
  for (let i = 0; i < 45; i += 1) store.logRequest(`10.0.0.${i}`);
  await new Promise((resolve) => { setTimeout(resolve, 3100); });
  const refused = post({ challenge: c, nonce }, '203.0.113.8');
  assert.equal(refused.passed, false);
  assert.equal(refused.r.body.error.details[0].issue, 'tooEasy');

  // The drawer's retry: a fresh challenge carries the surcharge of now and goes through.
  const fresh = res();
  proof.issueChallenge({ visitor: visitor('203.0.113.8'), body: {}, query: {} }, fresh);
  assert.ok(fresh.body.data.difficulty >= 16);
  await new Promise((resolve) => { setTimeout(resolve, 3100); });
  assert.equal(post({ challenge: fresh.body.data, nonce: challenge.solve(fresh.body.data) }, '203.0.113.8').passed, true);
});

test('rule 24: once a solving plugin was seen, an older reported version never lifts the proof', () => {
  reset();
  let since = '';
  const orig = { since: settings.proofEnforcedSince, mark: settings.markProofEnforced };
  settings.proofEnforcedSince = () => since;
  settings.markProofEnforced = () => { since = '2026-10-27T10:00:00Z'; };
  try {
    lastSeen = '';
    proof.issueChallenge({ visitor: visitor('81.250.12.4', '1.18.0'), body: {}, query: {} }, res());
    assert.ok(since, 'stamped');
    lastSeen = '1.17.1';
    assert.equal(proof.proofEnforced(), true);
    assert.equal(post({}).passed, false);
  } finally {
    settings.proofEnforcedSince = orig.since;
    settings.markProofEnforced = orig.mark;
  }
});
