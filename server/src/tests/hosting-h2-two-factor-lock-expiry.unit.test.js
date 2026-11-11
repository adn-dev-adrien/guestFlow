// specs/hosting-h2-account-security.md rule 8 — once a lock has expired the count starts again:
// a single typo after it is a plain « Code incorrect », not a new 15-minute lock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp } = require('./accountSecurityFixture');

test('rule 8 — after a lock expires, one wrong code does not lock again; five do', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  for (let i = 0; i < 4; i += 1) assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.status === 429);
  h.now.advance(15 * 60000 + 1000);
  for (let i = 0; i < 4; i += 1) assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.status === 401 && e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.status === 429);
  h.now.advance(15 * 60000 + 1000);
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.ok(h.twoFactor.verifyLogin(marie.id, { code: codeAt(secret, h.now()) }).user);
});
