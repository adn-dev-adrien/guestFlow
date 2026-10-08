// specs/hosting-h2-account-security.md rules 1-5 — the forgotten password: the same answer whatever
// the address, a link valid 1 hour that works once, older links voided, the request limits, every
// session ended by the reset, and no link without a mail transport.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeMailer, fakeRes, fakeSession, enableTotp } = require('./accountSecurityFixture');
const authController = require('../controllers/authController');

const tokenOf = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

test('rule 1 — the answer is the same whether the address has an account or not', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  const known = h.passwordReset.request({ email: 'Marie@Domaine-Ombre.fr ', ip: '1.1.1.1' });
  const unknown = h.passwordReset.request({ email: 'nobody@domaine-ombre.fr', ip: '1.1.1.1' });
  assert.equal(known.message, unknown.message);
  assert.equal(known.message, 'Si un compte existe, un lien vient d’être envoyé.');
  assert.equal(await known.delivery, true);
  assert.equal(await unknown.delivery, false);
  assert.equal(h.mailer.sent.length, 1);
  assert.equal(h.mailer.sent[0].to, 'marie@domaine-ombre.fr');
  assert.match(h.mailer.sent[0].text, /^Lien de réinitialisation/);
  assert.match(h.mailer.sent[0].text, /https:\/\/domaine-ombre\.guestflow\.fr\/nouveau-mot-de-passe\?token=/);
});

test('rule 1 — the HTTP answer of /forgot does not wait for the email', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  const c = authController.create(h.users, { passwordReset: h.passwordReset });
  const res = fakeRes();
  c.forgotPassword({ body: { email: 'marie@domaine-ombre.fr' }, ip: '1.1.1.1', session: fakeSession() }, res);
  assert.deepEqual(res.body, { message: 'Si un compte existe, un lien vient d’être envoyé.' });
});

test('rule 2 — only a SHA-256 of the token is stored; the link expires after 1 hour', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const token = tokenOf(h.mailer.sent[0]);
  const stored = h.db.prepare('SELECT tokenHash FROM password_reset_tokens').get().tokenHash;
  assert.notEqual(stored, token);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.equal(h.passwordReset.check(token).valid, true);
  h.now.advance(60 * 60 * 1000 + 1000);
  assert.equal(h.passwordReset.check(token).valid, false);
  assert.throws(() => h.passwordReset.reset({ token, password: 'a brand new password' }), (e) => e.body.error === 'INVALID_TOKEN');
});

test('rule 2 — a link works once', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const token = tokenOf(h.mailer.sent[0]);
  h.passwordReset.reset({ token, password: 'a brand new password' });
  assert.ok(h.users.verifyCredentials('marie@domaine-ombre.fr', 'a brand new password'));
  assert.throws(() => h.passwordReset.reset({ token, password: 'another new password' }), (e) => e.body.error === 'INVALID_TOKEN');
});

test('rule 2 — asking for a new link voids the older ones', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const [first, second] = h.mailer.sent.map(tokenOf);
  assert.equal(h.passwordReset.check(first).valid, false);
  assert.equal(h.passwordReset.check(second).valid, true);
});

test('rule 3 — 3 requests per address per hour; above, the same answer and nothing sent', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  for (let i = 0; i < 3; i += 1) await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: `10.0.0.${i}` }).delivery;
  const fourth = h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '10.0.0.9' });
  assert.equal(fourth.message, 'Si un compte existe, un lien vient d’être envoyé.');
  assert.equal(await fourth.delivery, false);
  assert.equal(h.mailer.sent.length, 3);
  h.now.advance(60 * 60 * 1000 + 1);
  assert.equal(await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '10.0.0.9' }).delivery, true);
});

test('rule 3 — 20 requests per IP per hour', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  for (let i = 0; i < 20; i += 1) h.passwordReset.request({ email: `x${i}@example.com`, ip: '6.6.6.6' });
  assert.equal(await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '6.6.6.6' }).delivery, false);
  assert.equal(await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '7.7.7.7' }).delivery, true);
});

test('rule 4 — the new password follows the existing rules', async () => {
  const h = setup();
  h.addUser('marie@domaine-ombre.fr');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const token = tokenOf(h.mailer.sent[0]);
  assert.throws(() => h.passwordReset.reset({ token, password: 'short' }), (e) => e.body.error === 'PASSWORD_TOO_SHORT');
  assert.equal(h.passwordReset.check(token).valid, true, 'a refused password does not spend the link');
});

test('rule 4 — saving ends every session of the user and logs the user in', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const other = h.addUser('paul@domaine-ombre.fr');
  const insert = h.db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
  insert.run('a', JSON.stringify({ user: { id: marie.id } }), '2099-01-01');
  insert.run('b', JSON.stringify({ pendingTwoFactor: { userId: marie.id, at: 0 } }), '2099-01-01');
  insert.run('c', JSON.stringify({ user: { id: other.id } }), '2099-01-01');
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const c = authController.create(h.users, { passwordReset: h.passwordReset, twoFactor: h.twoFactor });
  const res = fakeRes();
  const session = fakeSession();
  c.resetPassword({ body: { token: tokenOf(h.mailer.sent[0]), password: 'a brand new password' }, session, headers: {} }, res);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.db.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid), ['c']);
  assert.equal(session.user.id, marie.id);
  assert.equal(session.regenerated, 1);
  assert.equal(res.body.email, 'marie@domaine-ombre.fr');
  assert.equal(h.twoFactorModel.events(marie.id)[0].event, 'password_reset');
});

test('rule 4 — a reset never bypasses the second step', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await enableTotp(h, marie);
  await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery;
  const c = authController.create(h.users, { passwordReset: h.passwordReset, twoFactor: h.twoFactor });
  const res = fakeRes();
  const session = fakeSession();
  c.resetPassword({ body: { token: tokenOf(h.mailer.sent[h.mailer.sent.length - 1]), password: 'a brand new password' }, session, headers: {} }, res);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.body.step, 'second-factor');
  assert.equal(session.user, undefined);
  assert.equal(session.pendingTwoFactor.userId, marie.id);
});

test('rule 5 — without a mail transport (or the address links point to), no link is offered or sent', async () => {
  const mailer = makeMailer({ available: false });
  const h = setup({ mailer });
  h.addUser('marie@domaine-ombre.fr');
  assert.deepEqual(h.passwordReset.options(), { forgotPassword: false });
  assert.equal(await h.passwordReset.request({ email: 'marie@domaine-ombre.fr', ip: '1.1.1.1' }).delivery, false);
  mailer.state.available = true;
  mailer.state.publicUrl = '';
  assert.deepEqual(h.passwordReset.options(), { forgotPassword: false });
  mailer.state.publicUrl = 'https://domaine-ombre.guestflow.fr';
  assert.deepEqual(h.passwordReset.options(), { forgotPassword: true });
});

test('rule 5 — the account mailer points links at the configured address, never at the request', () => {
  const { createAccountMailer } = require('../utils/accountMailer');
  const settings = { publicUrl: () => '', smtpConfigured: () => false };
  assert.equal(createAccountMailer({ settingsModel: settings, env: {} }).publicUrl(), '');
  assert.equal(createAccountMailer({ settingsModel: settings, env: { GUESTFLOW_PUBLIC_URL: 'https://x.guestflow.fr/' } }).publicUrl(), 'https://x.guestflow.fr');
  assert.equal(createAccountMailer({ settingsModel: { ...settings, publicUrl: () => 'https://set.example/' }, env: {} }).publicUrl(), 'https://set.example');
  assert.equal(createAccountMailer({ settingsModel: settings, env: { GUESTFLOW_MAIL_OUTBOX: '/tmp/x' } }).available(), true);
  assert.equal(createAccountMailer({ settingsModel: settings, env: { GUESTFLOW_MAIL_OUTBOX: '/tmp/x', NODE_ENV: 'production' } }).available(), false, 'the dev outbox is refused in production');
});

test('the support account never receives a reset link', async () => {
  const h = setup();
  const r = h.passwordReset.request({ email: 'support@guestflow.invalid', ip: '1.1.1.1' });
  assert.equal(await r.delivery, false);
});
