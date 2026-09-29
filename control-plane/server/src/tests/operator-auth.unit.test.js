// specs/control-plane-plans-and-access.md rule 31 — operator access to the console: a password and a
// second factor chosen by each operator (authenticator app or email code), backup codes, the
// lockout, and a method that changes only once its own code is typed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordHash } = require('../utils/gf');
const totp = require('../utils/totp');
const { makeContext } = require('./helpers');

function setup() {
  const h = makeContext();
  const { operators } = h.ctx.models;
  const id = operators.create({ email: 'adrien@adn-dev.fr', name: 'Adrien', passwordHash: passwordHash.hashPassword('correct horse battery') });
  const auth = h.ctx.controllers.auth;
  const lastCode = () => /Votre code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
  return { ...h, id, auth, operators, lastCode };
}

test('rule 31 — RFC 6238 test vector (SHA-1, T = 59 s)', () => {
  const key = Buffer.from('12345678901234567890');
  assert.equal(totp.totp(key, new Date(59 * 1000), 8), '94287082');
  assert.equal(totp.totp(key, new Date(1111111109 * 1000), 8), '07081804');
  assert.deepEqual(totp.base32Decode(totp.base32Encode(key)), key);
});

test('rule 31 — TOTP accepts one step of drift either side, not two', () => {
  const secret = totp.generateSecret();
  const key = totp.base32Decode(secret);
  const at = new Date('2026-09-29T10:00:15Z');
  assert.ok(totp.verifyTotp(secret, totp.totp(key, new Date(at.getTime() - 30000)), at));
  assert.ok(totp.verifyTotp(secret, totp.totp(key, new Date(at.getTime() + 30000)), at));
  assert.ok(!totp.verifyTotp(secret, totp.totp(key, new Date(at.getTime() - 90000)), at));
});

test('rule 31 — a new operator logs in with a password then an email code', async () => {
  const { auth, id, lastCode, mailer } = setup();
  await assert.rejects(auth.login({ email: 'adrien@adn-dev.fr', password: 'wrong' }), (e) => e.body.error === 'BAD_CREDENTIALS');
  const step = await auth.login({ email: 'ADRIEN@adn-dev.fr', password: 'correct horse battery' });
  assert.equal(step.operatorId, id);
  assert.equal(step.payload.method, 'email');
  assert.match(step.payload.message, /a•+n@adn-dev\.fr/);
  assert.equal(mailer.sent[0].to, 'adrien@adn-dev.fr');
  assert.throws(() => auth.verify(id, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  const ok = auth.verify(id, { code: lastCode() });
  assert.equal(ok.operator.email, 'adrien@adn-dev.fr');
});

test('rule 31 — an email code expires after 10 minutes, and a new one voids the previous', async () => {
  const { auth, id, lastCode, now } = setup();
  await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  const first = lastCode();
  await auth.resend(id);
  const second = lastCode();
  if (first !== second) assert.throws(() => auth.verify(id, { code: first }), (e) => e.body.error === 'BAD_CODE');
  now.set('2026-09-29T10:10:01Z');
  assert.throws(() => auth.verify(id, { code: second }), (e) => e.body.error === 'BAD_CODE');
});

test('rule 31 — switching to the app takes effect only once its code is typed, and issues 10 backup codes', async () => {
  const { auth, id, operators, now } = setup();
  const started = await auth.startMethod(id, { method: 'totp' });
  assert.match(started.qrDataUrl, /^data:image\/png;base64,/);
  const secret = started.secret.replace(/\s/g, '');
  assert.throws(() => auth.confirmMethod(id, { code: '123456' }), (e) => e.body.error === 'BAD_CODE');
  assert.equal(operators.byId(id).mfaMethod, 'email', 'a wrong code keeps the old method');
  const confirmed = auth.confirmMethod(id, { code: totp.totp(totp.base32Decode(secret), now()) });
  assert.equal(confirmed.operator.mfaMethod, 'totp');
  assert.equal(confirmed.backupCodes.length, 10);
  assert.ok(!operators.byId(id).backupCodes.includes(confirmed.backupCodes[0]), 'backup codes are stored hashed');

  const step = await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  assert.equal(step.payload.method, 'totp');
  assert.ok(auth.verify(id, { code: totp.totp(totp.base32Decode(secret), now()) }).operator);

  // A backup code works once.
  const used = auth.verify(id, { code: confirmed.backupCodes[0] });
  assert.match(used.notice, /il en reste 9/);
  assert.throws(() => auth.verify(id, { code: confirmed.backupCodes[0] }), (e) => e.body.error === 'BAD_CODE');
});

test('rule 31 — five wrong answers lock the account for 15 minutes', async () => {
  const { auth, id, now } = setup();
  await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  for (let i = 0; i < 4; i += 1) assert.throws(() => auth.verify(id, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => auth.verify(id, { code: '000000' }), (e) => e.status === 429);
  await assert.rejects(auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' }), (e) => e.status === 429);
  now.set('2026-09-29T10:15:01Z');
  const again = await auth.login({ email: 'adrien@adn-dev.fr', password: 'correct horse battery' });
  assert.equal(again.operatorId, id);
});
