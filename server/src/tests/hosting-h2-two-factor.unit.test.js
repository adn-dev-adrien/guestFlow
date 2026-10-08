// specs/hosting-h2-account-security.md rules 6-11 — the second step of the login: enrolment by an
// authenticator app (±1 step of drift) or an email code, 10 single-use backup codes, the code asked
// after the password, the trusted device (revoked by a new password or by turning the step off),
// the lock after 5 wrong codes, an admin turning another user's step off, the dashboard card, and
// the TOTP helpers shared with the console.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { setup, fakeRes, fakeSession, codeAt, enableTotp } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');
const totp = require('../utils/totp');

function loginWith(h, { email = 'marie@domaine-ombre.fr', password = 'correct horse battery', cookie = '' } = {}) {
  const c = authController.create(h.users, { twoFactor: h.twoFactor, now: h.now });
  const res = fakeRes();
  const session = fakeSession();
  const out = c.login({ body: { email, password }, session, headers: { cookie } }, res, (e) => { throw e; });
  return Promise.resolve(out).then(() => ({ c, res, session }));
}

function verifyWith(c, session, body) {
  const res = fakeRes();
  c.verifySecondFactor({ body, session, headers: {} }, res, (e) => { throw e; });
  return res;
}

test('rule 6 — an authenticator app is enrolled by a QR code and confirmed by a first code (±1 step)', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await assert.rejects(h.twoFactor.start(marie, { method: 'totp', password: 'wrong' }), (e) => e.body.error === 'BAD_PASSWORD');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: 'correct horse battery' });
  assert.match(started.qrDataUrl, /^data:image\/png;base64,/);
  assert.match(Buffer.from(started.qrDataUrl.split(',')[1], 'base64').toString(), /^otpauth:\/\/totp\/GuestFlow%3Amarie%40domaine-ombre\.fr\?secret=/);
  const secret = started.secret.replace(/\s/g, '');
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.equal(h.twoFactor.status(marie).enabled, false, 'a wrong code keeps it off');
  const previousStep = codeAt(secret, new Date(h.now().getTime() - 30000));
  const confirmed = h.twoFactor.confirm(marie, { code: previousStep });
  assert.equal(confirmed.status.enabled, true);
  assert.equal(confirmed.status.method, 'totp');
  assert.equal(confirmed.backupCodes.length, 10);
  assert.ok(confirmed.backupCodes.every((c) => totp.BACKUP_CODE_RE.test(c)));
});

test('rule 6 — TOTP accepts one step of drift either side, not two', () => {
  const secret = totp.generateSecret();
  const at = new Date('2026-10-08T10:00:15Z');
  assert.ok(totp.verifyTotp(secret, codeAt(secret, new Date(at.getTime() + 30000)), at));
  assert.ok(!totp.verifyTotp(secret, codeAt(secret, new Date(at.getTime() - 90000)), at));
});

test('rule 6 — the email method sends a code and is confirmed by it', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'email', password: 'correct horse battery' });
  assert.match(started.sentTo, /^m•+e@domaine-ombre\.fr$/);
  const code = /Code : (\d{6})/.exec(h.mailer.sent[0].text)[1];
  const confirmed = h.twoFactor.confirm(marie, { code });
  assert.equal(confirmed.status.method, 'email');
  assert.equal(confirmed.status.methodLabel, 'Code par email');
});

test('rule 9 — the TOTP secret is stored encrypted, never in clear', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  const raw = h.db.prepare('SELECT secretEncrypted FROM user_two_factor WHERE userId = ?').get(marie.id).secretEncrypted;
  assert.notEqual(raw, secret);
  assert.ok(!raw.includes(secret));
  assert.deepEqual(require('../models/twoFactorModel').ENCRYPTED_COLUMNS, ['secretEncrypted', 'pendingSecretEncrypted']);
  assert.ok(!JSON.stringify(h.twoFactor.status(marie)).includes(secret), 'the status never carries it');
});

test('rule 7 — once on, the login asks for the code after the password', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  const { c, res, session } = await loginWith(h);
  assert.equal(res.body.step, 'second-factor');
  assert.equal(session.user, undefined, 'no session yet');
  h.now.advance(30000);
  const ok = verifyWith(c, session, { code: codeAt(secret, h.now()) });
  assert.equal(ok.body.email, 'marie@domaine-ombre.fr');
  assert.equal(session.user.id, marie.id);
});

test('rule 7 — a TOTP code is accepted once', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  h.now.advance(60000);
  const code = codeAt(secret, h.now());
  assert.ok(h.twoFactor.verifyLogin(marie.id, { code }).user);
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code }), (e) => e.body.error === 'BAD_CODE');
});

test('rule 6 — backup codes are single use', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { backupCodes } = await enableTotp(h, marie);
  const stored = h.db.prepare('SELECT codeHash FROM user_backup_codes WHERE userId = ?').all(marie.id).map((r) => r.codeHash);
  assert.ok(stored.every((x) => x.startsWith('scrypt:')), 'stored with the password hash');
  const first = h.twoFactor.verifyLogin(marie.id, { code: backupCodes[0].toUpperCase() });
  assert.equal(first.notice, 'Code de secours utilisé ; il en reste 9.');
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: backupCodes[0] }), (e) => e.body.error === 'BAD_CODE');
});

test('rule 7 — « faire confiance à cet appareil » skips the step, and a new password revokes it', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  const first = await loginWith(h);
  h.now.advance(30000);
  const verified = verifyWith(first.c, first.session, { code: codeAt(secret, h.now()), trustDevice: true });
  const [cookie] = verified.cookies;
  assert.equal(cookie.name, `guestflow.trust.${marie.id}`);
  assert.equal(cookie.opts.httpOnly, true);
  assert.equal(cookie.opts.maxAge, 30 * 24 * 3600 * 1000);
  const header = `${cookie.name}=${cookie.value}`;

  const trusted = await loginWith(h, { cookie: header });
  assert.equal(trusted.res.body.email, 'marie@domaine-ombre.fr', 'no second step on that browser');

  h.users.updatePassword(marie.id, 'a brand new password');
  const afterChange = await loginWith(h, { password: 'a brand new password', cookie: header });
  assert.equal(afterChange.res.body.step, 'second-factor', 'the trust died with the old password');
});

test('rule 7 — turning the step off revokes the trusted devices too', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await enableTotp(h, marie);
  const cookie = h.twoFactor.issueTrust(marie.id);
  const header = `${cookie.name}=${cookie.value}`;
  assert.equal(h.twoFactor.isRequired(marie, cookie.value), false);
  h.twoFactor.disable(marie, { password: 'correct horse battery' });
  h.now.advance(1000);
  const { secret } = await enableTotp(h, marie);
  assert.ok(secret);
  const again = await loginWith(h, { cookie: header });
  assert.equal(again.res.body.step, 'second-factor');
});

test('rule 7 — the trust expires after 30 days', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await enableTotp(h, marie);
  const cookie = h.twoFactor.issueTrust(marie.id);
  h.now.advance(30 * 24 * 3600 * 1000 + 1000);
  assert.equal(h.twoFactor.isRequired(marie, cookie.value), true);
});

test('rule 8 — 5 wrong codes lock the step for 15 minutes', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  for (let i = 0; i < 4; i += 1) assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: '000001' }), (e) => e.status === 429 && /^Trop d’essais : réessayer après \d\d:\d\d\.$/.test(e.body.message));
  h.now.advance(60000);
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: codeAt(secret, h.now()) }), (e) => e.status === 429, 'even the right code waits');
  await assert.rejects(h.twoFactor.beginLogin(marie), (e) => e.status === 429, 'the password step says it too');
  h.now.advance(15 * 60000);
  assert.ok(h.twoFactor.verifyLogin(marie.id, { code: codeAt(secret, h.now()) }).user);
});

test('rule 8 — 5 wrong codes while enrolling cancel the enrolment', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'totp', password: 'correct horse battery' });
  for (let i = 0; i < 4; i += 1) assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'TOO_MANY_CODES');
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'NO_PENDING_METHOD');
});

test('rule 9 — an administrator turns another user\'s second step off, recorded in that user\'s history', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const paul = h.addUser('paul@domaine-ombre.fr', { firstName: 'Paul', lastName: 'Martin' });
  await enableTotp(h, marie);
  const out = h.twoFactor.disableFor(paul, marie.id);
  assert.deepEqual(out, { userId: marie.id, twoFactorEnabled: false });
  assert.equal(h.twoFactorModel.isEnabled(marie.id), false);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM user_backup_codes WHERE userId = ?').get(marie.id).n, 0);
  const [event] = h.twoFactor.status(marie).events;
  assert.equal(event.label, 'Second code désactivé par Paul Martin');
  assert.throws(() => h.twoFactor.disableFor(paul, marie.id), (e) => e.body.error === 'NOT_ENABLED');
});

test('rule 9 — the users route refuses an admin\'s own step and lists who has one', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const paul = h.addUser('paul@domaine-ombre.fr');
  await enableTotp(h, marie);
  const { buildController } = require('../controllers/usersController');
  const c = buildController({
    usersModel: h.users,
    settingsModel: {},
    twoFactor: { disableFor: h.twoFactor.disableFor, enabledUserIds: h.twoFactorModel.enabledUserIds },
  });
  const listRes = fakeRes();
  c.list({ user: paul }, listRes);
  const byEmail = Object.fromEntries(listRes.body.users.map((u) => [u.email, u.twoFactorEnabled]));
  assert.deepEqual(byEmail, { 'marie@domaine-ombre.fr': true, 'paul@domaine-ombre.fr': false });
  const self = fakeRes();
  c.disableTwoFactor({ user: paul, params: { id: String(paul.id) } }, self);
  assert.equal(self.statusCode, 403);
  const other = fakeRes();
  c.disableTwoFactor({ user: paul, params: { id: String(marie.id) } }, other);
  assert.equal(other.body.twoFactorEnabled, false);
});

test('edge case — reset-admin.js --disable-2fa records the recovery in the history', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await enableTotp(h, marie);
  h.twoFactorModel.disable(marie.id);
  h.twoFactorModel.addEvent(marie.id, 'disabled_by_script', 'reset-admin.js', h.now().toISOString());
  assert.equal(h.twoFactor.status(marie).events[0].label, 'Second code désactivé en ligne de commande');
  const script = require('fs').readFileSync(path.join(__dirname, '..', '..', 'scripts', 'reset-admin.js'), 'utf8');
  assert.match(script, /--disable-2fa/);
  assert.match(script, /disabled_by_script/);
});

test('rule 10 — an admin without a second step sees the card; « Plus tard » hides it 30 days', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const anne = h.addUser('anne@domaine-ombre.fr', { roles: ['accountant'] });
  assert.equal(h.twoFactor.status(marie).nudge, true);
  assert.equal(h.twoFactor.status(anne).nudge, false, 'admins only');
  h.twoFactor.snooze(marie);
  assert.equal(h.twoFactor.status(marie).nudge, false);
  h.now.advance(30 * 24 * 3600 * 1000 + 1000);
  assert.equal(h.twoFactor.status(marie).nudge, true);
  await enableTotp(h, marie);
  assert.equal(h.twoFactor.status(marie).nudge, false, 'not once it is on');
});

test('rule 11 — the console requires the same TOTP module; its own copy is gone', () => {
  const consoleGf = path.join(__dirname, '..', '..', '..', 'control-plane', 'server', 'src', 'utils');
  assert.equal(require('fs').existsSync(path.join(consoleGf, 'totp.js')), false);
  const gfSource = require('fs').readFileSync(path.join(consoleGf, 'gf.js'), 'utf8');
  assert.match(gfSource, /totp: require\(path\.join\(GF_SERVER, 'src', 'utils', 'totp'\)\)/);
  assert.equal(totp.generateBackupCodes().length, 10);
  const [code] = totp.generateBackupCodes(1);
  assert.equal(totp.findBackupCode(code.toUpperCase(), [totp.hashBackupCode(code)]) !== null, true);
});
