// specs/hosting-h2-account-security.md rules 47, 49 and 53 (UX review of 2026-10-28) — turning the step
// off, minting new backup codes and changing the method ask the password AND a current code; the
// password is limited to 5 wrong tries per 15 minutes; a support session cannot reach any of it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp, fakeRes, fakeSession } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');
const { forbiddenReason } = require('../utils/supportSessionPolicy');

const PASSWORD = 'correct horse battery';
const SESSION = { sessionId: 'sid-marie' };
const MIN = 60000;

const code = (err) => err && err.body && err.body.error;

async function enabled(h, email = 'marie@domaine-ombre.fr') {
  const user = h.addUser(email);
  const enrolled = await enableTotp(h, user);
  h.now.advance(MIN);
  return { user, ...enrolled };
}

test('rule 47 — turning off, new backup codes and a new method are refused without a code', async () => {
  const h = setup();
  const { user, secret } = await enabled(h);
  assert.throws(() => h.twoFactor.disable(user, { password: PASSWORD }), (e) => code(e) === 'CODE_REQUIRED');
  assert.throws(() => h.twoFactor.regenerate(user, { password: PASSWORD, code: '  ' }), (e) => code(e) === 'CODE_REQUIRED');
  await assert.rejects(h.twoFactor.start(user, { method: 'totp', password: PASSWORD }, SESSION), (e) => code(e) === 'CODE_REQUIRED');
  assert.equal(h.twoFactor.status(user).enabled, true);
  assert.equal(h.twoFactorModel.get(user.id).pendingMethod, null, 'no replacement began');
  assert.equal(h.twoFactorModel.get(user.id).secretEncrypted, secret);
  assert.equal(h.twoFactorModel.get(user.id).failedCount, 0, 'a missing code is not a guess');
});

test('rule 47 — a wrong code is refused, counts toward rule 8\'s lock, and the 5th locks the step', async () => {
  const h = setup();
  const { user } = await enabled(h);
  for (let i = 0; i < 4; i += 1) {
    assert.throws(() => h.twoFactor.disable(user, { password: PASSWORD, code: '000000' }), (e) => code(e) === 'BAD_CODE');
  }
  assert.throws(() => h.twoFactor.regenerate(user, { password: PASSWORD, code: '000000' }), (e) => e.status === 429 && code(e) === 'LOCKED');
  assert.equal(h.twoFactor.status(user).enabled, true);
  assert.throws(() => h.twoFactor.verifyLogin(user.id, { code: '000000' }), (e) => code(e) === 'LOCKED', 'the login is locked by the same counter');
});

test('rule 47 — an app code, a backup code (spent) and an emailed code each authorise the change', async () => {
  const h = setup();
  const { user, secret, backupCodes } = await enabled(h);
  const renewed = h.twoFactor.regenerate(user, { password: PASSWORD, code: codeAt(secret, h.now()) });
  assert.equal(renewed.backupCodes.length, 10);
  assert.throws(() => h.twoFactor.disable(user, { password: PASSWORD, code: backupCodes[0] }), (e) => code(e) === 'BAD_CODE', 'the old codes are gone');

  const spendable = renewed.backupCodes[0];
  await h.twoFactor.start(user, { method: 'totp', password: PASSWORD, code: spendable }, SESSION);
  assert.equal(h.twoFactor.status(user).backupCodesLeft, 9, 'the backup code was spent by the re-authentication');
  assert.throws(() => h.twoFactor.disable(user, { password: PASSWORD, code: spendable }), (e) => code(e) === 'BAD_CODE', 'a backup code works once');

  const e = setup();
  const paul = e.addUser('paul@domaine-ombre.fr');
  await e.twoFactor.start(paul, { method: 'email', password: PASSWORD }, SESSION);
  e.twoFactor.confirm(paul, { code: /Code : (\d{6})/.exec(e.mailer.sent[0].text)[1] });
  e.now.advance(MIN);
  await e.twoFactor.sendCode(paul);
  assert.equal(e.mailer.sent.length, 2);
  const emailed = /Code : (\d{6})/.exec(e.mailer.sent[1].text)[1];
  assert.throws(() => e.twoFactor.disable(paul, { password: PASSWORD, code: '000000' }), (err) => code(err) === 'BAD_CODE');
  assert.equal(e.twoFactor.disable(paul, { password: PASSWORD, code: emailed }).enabled, false);
});

test('rule 47 — a method change re-authenticates, and a wrong password does not even look at the code', async () => {
  const h = setup();
  const { user, secret } = await enabled(h);
  await assert.rejects(h.twoFactor.start(user, { method: 'totp', password: 'wrong', code: codeAt(secret, h.now()) }, SESSION), (e) => code(e) === 'BAD_PASSWORD');
  assert.equal(h.twoFactorModel.get(user.id).lastTotpStep, Math.floor((h.now().getTime() - MIN) / 30000), 'the code was not spent');
  const started = await h.twoFactor.start(user, { method: 'totp', password: PASSWORD, code: codeAt(secret, h.now()) }, SESSION);
  assert.equal(started.replacing, true);
});

test('rule 47 + 28 — the app code spent on a re-authentication cannot then open a session', async () => {
  const h = setup();
  const { user, secret } = await enabled(h);
  const spent = codeAt(secret, h.now());
  h.twoFactor.regenerate(user, { password: PASSWORD, code: spent });
  assert.throws(() => h.twoFactor.verifyLogin(user.id, { code: spent }), (e) => code(e) === 'BAD_CODE');
  h.now.advance(30000);
  assert.ok(h.twoFactor.verifyLogin(user.id, { code: codeAt(secret, h.now()) }).user, 'the next code still opens one');
});

test('rule 47 — the administrator\'s « turn off » for another user needs neither the password nor a code', async () => {
  const h = setup();
  const { user } = await enabled(h);
  const paul = h.addUser('paul@domaine-ombre.fr', { firstName: 'Paul' });
  assert.deepEqual(h.twoFactor.disableFor(paul, user.id), { userId: user.id, twoFactorEnabled: false });
});

test('rule 49 — 5 wrong passwords lock disable, new codes and a new method for 15 minutes, even for the right one', async () => {
  const h = setup();
  const { user, secret } = await enabled(h);
  const wrong = [
    () => h.twoFactor.disable(user, { password: 'nope-1', code: '000000' }),
    () => h.twoFactor.regenerate(user, { password: 'nope-2', code: '000000' }),
    () => h.twoFactor.start(user, { method: 'totp', password: 'nope-3', code: '000000' }, SESSION),
    () => h.twoFactor.disable(user, { password: 'nope-4', code: '000000' }),
  ];
  for (const attempt of wrong) await assert.rejects(Promise.resolve().then(attempt), (e) => code(e) === 'BAD_PASSWORD');
  await assert.rejects(Promise.resolve().then(() => h.twoFactor.disable(user, { password: 'nope-5', code: '000000' })),
    (e) => e.status === 429 && code(e) === 'REAUTH_LOCKED' && /^Trop d’essais : réessayer après \d\d:\d\d\.$/.test(e.body.message));

  h.now.advance(5 * MIN);
  const good = { password: PASSWORD, code: codeAt(secret, h.now()) };
  assert.throws(() => h.twoFactor.disable(user, good), (e) => code(e) === 'REAUTH_LOCKED');
  assert.throws(() => h.twoFactor.regenerate(user, good), (e) => code(e) === 'REAUTH_LOCKED');
  await assert.rejects(h.twoFactor.start(user, { method: 'totp', ...good }, SESSION), (e) => code(e) === 'REAUTH_LOCKED');
  assert.equal(h.twoFactor.status(user).enabled, true);

  h.now.advance(10 * MIN + 1000);
  assert.equal(h.twoFactor.disable(user, { password: PASSWORD, code: codeAt(secret, h.now()) }).enabled, false, 'open again after 15 minutes');
});

test('rule 49 — the lock also covers the first activation, is written to the journal once, and spares other accounts', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const paul = h.addUser('paul@domaine-ombre.fr');
  for (let i = 0; i < 4; i += 1) await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: `nope-${i}` }, SESSION), (e) => code(e) === 'BAD_PASSWORD');
  await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: 'nope-4' }, SESSION), (e) => code(e) === 'REAUTH_LOCKED');
  await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: PASSWORD }, SESSION), (e) => code(e) === 'REAUTH_LOCKED');
  await assert.rejects(h.twoFactor.start(marie, { method: 'email', password: PASSWORD }, SESSION), (e) => code(e) === 'REAUTH_LOCKED');
  const journal = h.twoFactor.status(marie).events;
  assert.deepEqual(journal.map((e) => e.label), ['Trop d’essais du mot de passe (validation en deux étapes)']);
  assert.ok((await h.twoFactor.start(paul, { method: 'totp', password: PASSWORD }, { sessionId: 'sid-paul' })).secret, 'another account is unaffected');
});

test('rule 49 — an empty password is not a guess, and 4 wrong ones within the window followed by time do not lock', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  for (let i = 0; i < 10; i += 1) await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: '' }, SESSION), (e) => code(e) === 'BAD_PASSWORD');
  for (let i = 0; i < 4; i += 1) await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: `nope-${i}` }, SESSION), (e) => code(e) === 'BAD_PASSWORD');
  h.now.advance(16 * MIN);
  await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: 'nope-late' }, SESSION), (e) => code(e) === 'BAD_PASSWORD', 'the window slid past the old tries');
  assert.ok((await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD }, SESSION)).secret);
});

test('rule 49 — the lock concerns the confirmation routes only: the password and the second step still work at login', async () => {
  const h = setup();
  const { user } = await enabled(h);
  for (let i = 0; i < 5; i += 1) await Promise.resolve().then(() => h.twoFactor.disable(user, { password: `nope-${i}`, code: '000000' })).catch(() => {});
  assert.ok(h.users.verifyCredentials(user.email, PASSWORD), 'the password itself still works');
  assert.ok(h.twoFactor.isRequired(user, ''), 'the second step is still required at login');
});

test('rule 53 — /2fa/cancel and /2fa/code are writes under /auth/2fa, refused to a support session like the others', () => {
  for (const path of ['/auth/2fa/cancel', '/auth/2fa/code', '/auth/2fa/start', '/auth/2fa/disable', '/auth/2fa/backup-codes']) {
    assert.equal(forbiddenReason('POST', path), 'account', path);
    assert.equal(forbiddenReason('POST', `/Auth//2FA/${path.split('/').pop()}/`), 'account', `${path} with odd casing and a trailing slash`);
  }
  assert.equal(forbiddenReason('GET', '/auth/2fa/status'), null, 'reading the status stays a read');
});

test('rule 53 — the self gate refuses cancel and code to a session whose account is gone', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now });
  h.users.softDelete(marie.id);
  for (const handler of [c.twoFactorCancel, c.twoFactorCode]) {
    const res = fakeRes();
    await handler({ session: fakeSession({ user: marie }), body: {}, headers: {} }, res, () => {});
    assert.equal(res.statusCode, 401);
  }
});
