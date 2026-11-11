// specs/hosting-h2-account-security.md rule 35 (console side, specs/control-plane-plans-and-access.md
// rule 31) — the operator's code is read as typed: an email code with a space in the middle, a backup
// code without its dash.

const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordHash, totp } = require('../utils/gf');
const { makeContext } = require('./helpers');

test('rule 35 — « 123 456 » and a backup code without its dash are accepted', async () => {
  const h = makeContext();
  const { operators } = h.ctx.models;
  const id = operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const auth = h.ctx.controllers.auth;
  await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  const code = /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
  assert.ok(auth.verify(id, { code: `${code.slice(0, 3)} ${code.slice(3)}` }).operator);

  const started = await auth.startMethod(id, { method: 'totp', password: 'correct horse battery' });
  const secret = started.secret.replace(/\s/g, '');
  const { backupCodes } = auth.confirmMethod(id, { code: totp.totp(totp.base32Decode(secret), h.now()) });
  await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  assert.ok(auth.verify(id, { code: backupCodes[0].replace('-', '').toUpperCase() }).operator);
});
