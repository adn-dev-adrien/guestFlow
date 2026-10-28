require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 32 (adversarial review of the 2026-10-27 spec-review
// fixes) — since rule 29 a challenge was judged only at its signed difficulty, so a bot could fetch
// five challenges at the base 12 bits and spend them all. At verification the challenge must now cover
// the address's own sends of the hour (excluding the current one) and the flood surcharge with a
// one-step grace; a real guest following the drawer's protocol (a fresh challenge after every send, one
// retry on CHALLENGE_INVALID) is never refused.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_REQUEST_CHALLENGE_SECRET = 'test-secret';
const db = require('../../../database');
const challenge = require('../challenge');
const store = require('../requestStore');
const settings = require('../settings');

settings.termsSettings = () => ({ requireTermsAcceptance: false, lastSeenPluginVersion: '1.18.0' });
settings.recordPluginVersion = () => {};
const proof = require('../controllers/publicChallengeController');

const MIN_FILL = challenge.MIN_FILL_MS + 50;
let clock = Date.parse('2027-03-01T10:00:00Z');
const realNow = Date.now;
Date.now = () => clock;
test.after(() => { Date.now = realNow; });

function res() {
  return {
    statusCode: 200, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
  };
}
const visitor = (ip) => ({ ip, userAgent: 'test', pluginVersion: '1.18.0' });
const issue = (ip) => {
  const r = res();
  proof.issueChallenge({ visitor: visitor(ip), body: {}, query: {} }, r);
  return r.body.data;
};
function post(c, ip) {
  const r = res();
  let passed = false;
  proof.requireProof({ body: { challenge: c, nonce: challenge.solve(c) }, visitor: visitor(ip), query: {}, headers: {} }, r, () => { passed = true; });
  return { passed, status: r.statusCode, issue: r.body && r.body.error && r.body.error.details && r.body.error.details[0].issue };
}
store.ensureTables();
const reset = () => db.exec('DELETE FROM public_request_log; DELETE FROM public_request_challenges_used;');

test('rule 32: five challenges fetched ahead at the base cannot all be spent', () => {
  reset();
  const ip = '203.0.113.20';
  const ahead = Array.from({ length: 5 }, () => issue(ip));
  assert.deepEqual(ahead.map((c) => c.difficulty), [12, 12, 12, 12, 12]);
  clock += MIN_FILL;
  const results = ahead.map((c) => post(c, ip));
  assert.equal(results[0].passed, true, 'the first is owed 12 bits');
  results.slice(1).forEach((r) => {
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
    assert.equal(r.issue, 'tooEasy');
  });
  assert.equal(store.countRecent({ ipKey: ip }), 1, 'a refused challenge is not logged as a request');
});

// The drawer's protocol (integrations/wordpress/guestflow-booking/blocks/booking/view.js `send`): the
// proof prepared beforehand is spent, a fresh one is fetched right after the answer, and a
// CHALLENGE_INVALID other than `missing` is retried once with that fresh one.
function drawerSend(state, ip) {
  clock += MIN_FILL;
  let answer = post(state.proof, ip);
  state.proof = issue(ip);
  if (!answer.passed && answer.status === 403 && answer.issue !== 'missing') {
    clock += MIN_FILL;
    answer = post(state.proof, ip);
    state.proof = issue(ip);
  }
  return answer;
}

test('rule 32: a real guest sending three requests in a row through the drawer is never refused', () => {
  reset();
  const ip = '198.51.100.30';
  const state = { proof: issue(ip) };
  const answers = [drawerSend(state, ip), drawerSend(state, ip), drawerSend(state, ip)];
  assert.deepEqual(answers.map((a) => a.passed), [true, true, true]);
  assert.equal(state.proof.difficulty, 18, 'the next one is owed 12 + 3 × 2 bits');
});

test('rule 32: a guest whose challenge predates another send from the same address gets through on the retry', () => {
  reset();
  const ip = '198.51.100.31';
  const first = { proof: issue(ip) };
  const second = { proof: issue(ip) };
  assert.equal(drawerSend(first, ip).passed, true);
  const answer = drawerSend(second, ip);
  assert.equal(answer.passed, true, 'refused tooEasy once, then accepted with the fresh challenge');
});

test('rule 32: a challenge issued just before the flood surcharge steps up still passes (one-step grace)', () => {
  reset();
  for (let i = 0; i < 20; i += 1) store.logRequest(`10.1.0.${i}`);
  const ip = '192.0.2.40';
  const c = issue(ip);
  assert.equal(c.difficulty, 12, 'issued at exactly 20 requests: no surcharge yet');
  for (let i = 0; i < 10; i += 1) store.logRequest(`10.2.0.${i}`);
  clock += MIN_FILL;
  assert.equal(challenge.surgeBits(store.countRecent({})), 2, 'the hour now owes +2 bits');
  assert.equal(post(c, ip).passed, true);
});

test('rule 32: another address flooding never refuses a challenge issued before it', () => {
  reset();
  const ip = '192.0.2.41';
  const c = issue(ip);
  for (let i = 0; i < 30; i += 1) store.logRequest('10.9.9.9');
  clock += MIN_FILL;
  assert.equal(post(c, ip).passed, true);
});

test('rule 32: the required difficulty is capped like the issued one', () => {
  assert.equal(challenge.requiredDifficulty({ addressRequestsLastHour: 0, requestsLastHour: 0 }), 12);
  assert.equal(challenge.requiredDifficulty({ addressRequestsLastHour: 2, requestsLastHour: 45 }), 18);
  assert.equal(challenge.requiredDifficulty({ addressRequestsLastHour: 9, requestsLastHour: 500 }), challenge.MAX_BITS);
});

test('rule 29 nit: opening the store on a fresh database never creates the issued-challenge log', () => {
  const Database = require('better-sqlite3');
  const fresh = new Database(':memory:');
  let created = false;
  const exec = fresh.exec.bind(fresh);
  fresh.exec = (sql) => { if (/CREATE TABLE IF NOT EXISTS public_request_issued/.test(sql)) created = true; return exec(sql); };
  store.ensureTables(fresh);
  assert.equal(created, false);
  const cols = fresh.prepare('PRAGMA table_info(public_request_stays)').all().map((col) => col.name);
  assert.ok(cols.includes('appendCount') && cols.includes('lastRequestAt'));
});
