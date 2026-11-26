// specs/site-outside-resource-booking.md rule 8 — one judgment of the proof of work for every public form: the voucher calls use the SDK's guard, so a challenge spent on one form is spent on all
// of them (the lodging request, the session confirmation), and a challenge issued below what the address owes now is refused `tooEasy`.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const sdk = require('../../sdk');
const { createProof } = require('../proof');

const SECRET = 'a-secret';
const pow = sdk.proofOfWork;
const store = sdk.proofGuard.store;

const IP = '198.51.100.7';
const solved = (difficulty = pow.BASE_BITS, ip = IP) => {
  const challenge = pow.issue({
    secret: SECRET, ipKey: pow.ipKeyOf(ip), difficulty, now: Date.now() - 5000,
  });
  return { challenge, nonce: pow.solve(challenge) };
};
const request = (body, ip = IP) => ({ body, visitor: { ip } });

test('rule 8 — one solved challenge is spent once across the voucher proof, the lodging guard and the session guard', () => {
  const voucher = createProof({ pow, secret: () => SECRET });
  const lodging = sdk.proofGuard.createProofGuard({ secret: () => SECRET });
  const sessions = sdk.proofGuard.createProofGuard({ secret: () => SECRET });
  const body = solved();
  assert.equal(voucher(request(body)).ok, true);
  assert.deepEqual(lodging.check({ body, ip: IP }), { ok: false, issue: 'used' });
  assert.deepEqual(sessions.check({ body, ip: IP }), { ok: false, issue: 'used' });
  const other = solved(pow.BASE_BITS + 2); // the address sent one request: two more bits are owed
  assert.equal(sessions.check({ body: other, ip: IP }).ok, true);
  assert.equal(voucher(request(other)).ok, false, 'and the other way round');
});

test('rule 8 — the difficulty is the lodging tunnel’s: what the address already sent in the hour is owed, a challenge fetched ahead is refused tooEasy and stays spent', () => {
  const guard = sdk.proofGuard.createProofGuard({ secret: () => SECRET });
  const ip = '198.51.100.8';
  assert.equal(guard.check({ body: solved(pow.BASE_BITS, ip), ip }).ok, true);
  assert.equal(guard.check({ body: solved(pow.BASE_BITS + 2, ip), ip }).ok, true);
  const owed = pow.requiredDifficulty({ addressRequestsLastHour: store.countRecent({ ipKey: pow.ipKeyOf(ip) }), requestsLastHour: store.countRecent({}) });
  assert.ok(owed > pow.BASE_BITS);
  const easy = solved(pow.BASE_BITS, ip);
  assert.deepEqual(guard.check({ body: easy, ip }), { ok: false, issue: 'tooEasy' });
  assert.deepEqual(guard.check({ body: easy, ip }), { ok: false, issue: 'used' });
  assert.equal(guard.check({ body: solved(owed, ip), ip }).ok, true);
});

test('rule 8 — a proof signed for another address, a missing one and a forged one are refused with their reason, and cost the address nothing', () => {
  const guard = sdk.proofGuard.createProofGuard({ secret: () => SECRET });
  const ip = '198.51.100.9';
  const before = store.countRecent({ ipKey: pow.ipKeyOf(ip) });
  assert.equal(guard.check({ body: solved(pow.BASE_BITS, '203.0.113.1'), ip }).issue, 'forged');
  assert.equal(guard.check({ body: {}, ip }).issue, 'missing');
  assert.equal(guard.check({ body: undefined, ip }).issue, 'missing');
  assert.equal(store.countRecent({ ipKey: pow.ipKeyOf(ip) }), before);
});
