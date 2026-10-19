// specs/hosting-h2-account-security.md rule 35 — the server reads a code the way it was typed or
// pasted: « 123 456 » or « 123-456 » is the 6-digit code, a backup code without its dash or with
// spaces is that backup code. Shared with the console (utils/totp.js through utils/gf.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp } = require('./accountSecurityFixture');
const totp = require('../utils/totp');

test('rule 35 — normalizeCode: separators out of a 6-digit code, the dash back into a backup code', () => {
  assert.equal(totp.normalizeCode(' 123 456 '), '123456');
  assert.equal(totp.normalizeCode('123-456'), '123456');
  assert.equal(totp.normalizeCode('123.456'), '123456');
  assert.equal(totp.normalizeCode('K3PASY35NR'), 'k3pas-y35nr');
  assert.equal(totp.normalizeCode('k3pas y35nr'), 'k3pas-y35nr');
  assert.equal(totp.normalizeCode('k3pas-y35nr'), 'k3pas-y35nr');
  assert.equal(totp.normalizeCode('12345'), '12345');
  assert.equal(totp.normalizeCode('1234567'), '1234567');
  assert.ok(totp.isBackupCodeShape('k3pasy35nr'));
});

test('rule 35 — a backup code typed without its dash opens the session', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { backupCodes } = await enableTotp(h, marie);
  const out = h.twoFactor.verifyLogin(marie.id, { code: backupCodes[0].replace('-', '').toUpperCase() });
  assert.equal(out.notice, 'Code de secours utilisé ; il en reste 9.');
});

test('rule 35 — an app code with a space or a dash in the middle is accepted', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  const next = codeAt(secret, new Date(h.now().getTime() + 30000));
  assert.doesNotThrow(() => h.twoFactor.verifyLogin(marie.id, { code: `${next.slice(0, 3)}-${next.slice(3)}` }));
});
