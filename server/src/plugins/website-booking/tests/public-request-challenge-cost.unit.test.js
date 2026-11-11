require('./isolatedDb');
// specs/public-request-abuse-and-grouping.md rule 29 (2026-10-27 spec review, replaces rule 23) — what
// raises the difficulty is the requests an address MADE in the hour, never the challenges it was
// handed: five page views from a phone used to cost the next request 22 bits (10-20 s). And a
// challenge is judged at the difficulty signed into it: one issued just before the hour's total crossed
// 20 is not refused `tooEasy` when it is sent just after.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_REQUEST_CHALLENGE_SECRET = 'test-secret';
const db = require('../../../database');
const challenge = require('../challenge');
const store = require('../requestStore');
const settings = require('../settings');

let lastSeen = '1.18.0';
settings.termsSettings = () => ({ requireTermsAcceptance: false, lastSeenPluginVersion: lastSeen });
settings.recordPluginVersion = (v) => { lastSeen = v; };
const proof = require('../controllers/publicChallengeController');

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
function post(body, ip) {
  const r = res();
  let passed = false;
  proof.requireProof({ body, visitor: visitor(ip), query: {}, headers: {} }, r, () => { passed = true; });
  return { passed, r };
}
store.ensureTables();
const reset = () => db.exec('DELETE FROM public_request_log; DELETE FROM public_request_challenges_used;');

test('rule 29: page views cost nothing — six challenges in a row from one address stay at the base', () => {
  reset();
  const difficulties = Array.from({ length: 6 }, () => issue('203.0.113.7').difficulty);
  assert.deepEqual(difficulties, [12, 12, 12, 12, 12, 12]);
});

test('rule 29: the requests an address made still raise its next challenge', async () => {
  reset();
  const first = issue('203.0.113.9');
  await new Promise((resolve) => { setTimeout(resolve, 3100); });
  assert.equal(post({ challenge: first, nonce: challenge.solve(first) }, '203.0.113.9').passed, true);
  assert.equal(issue('203.0.113.9').difficulty, 14);
  assert.equal(issue('198.51.100.4').difficulty, 12, 'another address is not affected');
});

test('rule 29: challenges issued just before the hour crosses 20 are accepted when sent in parallel just after', async () => {
  reset();
  for (let i = 0; i < 18; i += 1) store.logRequest(`10.0.0.${i}`);
  const senders = Array.from({ length: 7 }, (_, i) => `192.0.2.${i + 1}`);
  const issued = senders.map((ip) => ({ ip, c: issue(ip) }));
  issued.forEach(({ c }) => assert.equal(c.difficulty, 12, 'issued under the threshold'));
  const solved = issued.map(({ ip, c }) => ({ ip, c, nonce: challenge.solve(c) }));
  await new Promise((resolve) => { setTimeout(resolve, 3100); });
  const results = await Promise.all(solved.map(({ ip, c, nonce }) => Promise.resolve().then(() => post({ challenge: c, nonce }, ip))));
  assert.deepEqual(results.map((r) => r.passed), Array(7).fill(true), 'none refused tooEasy');
  assert.equal(store.countRecent({}), 25, 'the hour now counts 25 requests');
  assert.ok(issue('192.0.2.99').difficulty > 12, 'the flood surcharge applies to challenges issued from now on');
});

test('rule 29: the issued-challenge log is gone', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'public_request_issued'").get().n, 0);
});
