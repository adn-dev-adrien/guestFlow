// specs/hosting-h2-account-security.md rules 40-46 and 51 (UX review of 2026-10-28) — the activation:
// what `start` hands the client, the tries left on a wrong code, the 15-minute expiry, the email
// fallback inside an enrolment with its resend gap, `cancel`, the status labels, the dashboard wording.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp } = require('./accountSecurityFixture');
const { CORE_SUMMARIES } = require('../utils/dashboardAttention');

const PASSWORD = 'correct horse battery';
const MIN = 60000;

function labelOf(uri) {
  return decodeURIComponent(/^otpauth:\/\/totp\/([^?]+)/.exec(uri)[1]);
}

test('rule 41 — start returns the otpauth URI, the issuer and « company · email » as the entry name', async () => {
  const h = setup({ companyName: 'Domaine des Oliviers' });
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.equal(started.issuer, 'GuestFlow');
  assert.equal(started.accountLabel, 'Domaine des Oliviers · marie@domaine-ombre.fr');
  assert.equal(labelOf(started.otpauthUri), 'GuestFlow:Domaine des Oliviers · marie@domaine-ombre.fr');
  assert.match(started.otpauthUri, /issuer=GuestFlow/);
  assert.match(started.secret, /^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
  assert.ok(started.otpauthUri.includes(`secret=${started.secret.replace(/\s/g, '')}`));
  assert.equal(started.replacing, false);
  assert.equal(started.expiresAt, new Date(h.now().getTime() + 15 * MIN).toISOString());
});

test('rule 41 — without a company name the entry is named by the email alone', async () => {
  const h = setup({ companyName: '  ' });
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.equal(started.accountLabel, 'marie@domaine-ombre.fr');
  assert.equal(labelOf(started.otpauthUri), 'GuestFlow:marie@domaine-ombre.fr');
});

test('rule 41 — the status never carries the secret, pending or not', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  const secret = started.secret.replace(/\s/g, '');
  assert.ok(!JSON.stringify(h.twoFactor.status(marie)).includes(secret), 'pending');
  h.twoFactor.confirm(marie, { code: codeAt(secret, h.now()) });
  assert.ok(!JSON.stringify(h.twoFactor.status(marie)).includes(secret), 'active');
});

test('rule 42 — a wrong code says the tries left, the clock hint comes from the 3rd refusal, the 5th cancels', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  const refusal = () => { try { h.twoFactor.confirm(marie, { code: '000000' }); } catch (e) { return e; } return null; };
  const expected = [
    [4, 'Code incorrect : 4 essais restants.'],
    [3, 'Code incorrect : 3 essais restants.'],
    [2, 'Code incorrect : 2 essais restants. Vérifier l’heure du téléphone.'],
    [1, 'Code incorrect : 1 essai restant. Vérifier l’heure du téléphone.'],
  ];
  expected.forEach(([left, message]) => {
    const e = refusal();
    assert.equal(e.status, 400);
    assert.equal(e.body.error, 'BAD_CODE');
    assert.equal(e.body.attemptsLeft, left);
    assert.equal(e.body.message, message);
  });
  const fifth = refusal();
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.error, 'TOO_MANY_CODES');
  assert.equal(fifth.body.message, 'Trop de codes incorrects : activation annulée.');
  assert.equal(refusal().body.error, 'NO_PENDING_METHOD', 'the enrolment is gone');
});

test('rule 43 — an enrolment older than 15 minutes answers 410 and is dropped', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  const code = codeAt(started.secret.replace(/\s/g, ''), new Date(h.now().getTime() + 15 * MIN));
  h.now.advance(15 * MIN);
  assert.throws(() => h.twoFactor.confirm(marie, { code }), (e) => e.status === 410 && e.body.error === 'ENROLMENT_EXPIRED' && e.body.message === 'Activation expirée : recommencer.');
  assert.equal(h.twoFactorModel.get(marie.id).pendingMethod, null);
  assert.throws(() => h.twoFactor.confirm(marie, { code }), (e) => e.body.error === 'NO_PENDING_METHOD');
});

test('rule 43 — an enrolment begun before the update (no start recorded) reads as expired', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  h.db.prepare('UPDATE user_two_factor SET pendingStartedAt = NULL WHERE userId = ?').run(marie.id);
  const code = codeAt(started.secret.replace(/\s/g, ''), h.now());
  assert.throws(() => h.twoFactor.confirm(marie, { code }), (e) => e.body.error === 'ENROLMENT_EXPIRED');
});

test('rules 44, 54 — the email fallback needs no password for the holder of the enrolment\'s token, and only there', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const first = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.match(first.enrolmentToken, /^[0-9a-f]{64}$/);
  const switched = await h.twoFactor.start(marie, { method: 'email', enrolmentToken: first.enrolmentToken });
  assert.match(switched.sentTo, /^m•+e@domaine-ombre\.fr$/);
  assert.equal(switched.resendInSeconds, 60);
  assert.equal(switched.enrolmentToken, first.enrolmentToken);
  assert.equal(h.mailer.sent.length, 1);

  const refused = (body) => assert.rejects(h.twoFactor.start(marie, body), (e) => e.body.error === 'BAD_PASSWORD');
  await refused({ method: 'email' });
  await refused({ method: 'totp', enrolmentToken: 'f'.repeat(64) });
  await refused({ method: 'totp', enrolmentToken: undefined });
  assert.equal(h.mailer.sent.length, 1);

  h.now.advance(15 * MIN);
  await refused({ method: 'email', enrolmentToken: first.enrolmentToken });
  assert.equal(h.mailer.sent.length, 1);
});

test('rule 54 — the token is stored only as a hash, and a new enrolment cancels the old one\'s token', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const first = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.ok(!JSON.stringify(h.twoFactorModel.get(marie.id)).includes(first.enrolmentToken));
  const second = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.notEqual(second.enrolmentToken, first.enrolmentToken);
  await assert.rejects(h.twoFactor.start(marie, { method: 'email', enrolmentToken: first.enrolmentToken }), (e) => e.body.error === 'BAD_PASSWORD');
});

test('rule 44 — the switch does not extend the enrolment, and going back to the app gives a new secret', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const first = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  const { enrolmentToken } = first;
  h.now.advance(5 * MIN);
  await h.twoFactor.start(marie, { method: 'email', enrolmentToken });
  h.now.advance(MIN);
  const back = await h.twoFactor.start(marie, { method: 'totp', enrolmentToken });
  assert.notEqual(back.secret, first.secret);
  assert.equal(back.expiresAt, first.expiresAt, 'still 15 minutes from the password');
});

test('rule 55 — an instance that cannot send mail refuses the switch and keeps the app enrolment', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const first = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  h.mailer.state.available = false;
  await assert.rejects(h.twoFactor.start(marie, { method: 'email', enrolmentToken: first.enrolmentToken }), (e) => e.body.error === 'EMAIL_UNAVAILABLE');
  await assert.rejects(h.twoFactor.start(marie, { method: 'email', password: PASSWORD }), (e) => e.body.error === 'EMAIL_UNAVAILABLE');
  assert.equal(h.twoFactorModel.get(marie.id).pendingMethod, 'totp', 'the secret on screen is still the pending one');
  assert.ok(h.twoFactor.confirm(marie, { code: codeAt(first.secret.replace(/\s/g, ''), h.now()) }).status.enabled);
});

test('rule 55 — parallel « Renvoyer le code » send one mail, not twenty', async () => {
  const mailer = { sent: [], available: () => true, publicUrl: () => 'x', async send(m) { await new Promise((r) => setTimeout(r, 20)); this.sent.push(m); } };
  const h = setup({ mailer });
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'email', password: PASSWORD });
  h.now.advance(61000);
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => h.twoFactor.sendCode(marie)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(mailer.sent.length, 2, 'the first mail and one resend');
  assert.equal(h.twoFactorModel.get(marie.id).pendingSends, 2);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.body.error === 'RESEND_TOO_SOON'));
});

test('rule 55 — restarting with the password cannot reset the sends: the gap and the hour apply to a start too', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'email', password: PASSWORD });
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(h.twoFactor.start(marie, { method: 'email', password: PASSWORD }), (e) => e.body.error === 'RESEND_TOO_SOON');
  }
  assert.equal(h.mailer.sent.length, 1, '10 immediate starts send one mail');
  for (let i = 0; i < 5; i += 1) {
    h.now.advance(61000);
    await h.twoFactor.start(marie, { method: 'email', password: PASSWORD });
  }
  h.now.advance(61000);
  await assert.rejects(h.twoFactor.start(marie, { method: 'email', password: PASSWORD }), (e) => e.body.error === 'TOO_MANY_SENDS', '6 mails an hour at most');
  assert.equal(h.mailer.sent.length, 6);
  h.now.advance(3600000);
  await h.twoFactor.start(marie, { method: 'email', password: PASSWORD });
  assert.equal(h.mailer.sent.length, 7, 'a new hour');
});

test('rule 44 — « Renvoyer le code » waits 60 s, and the 6th send of an enrolment is refused', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'email', password: PASSWORD });
  h.now.advance(42 * 1000);
  await assert.rejects(h.twoFactor.sendCode(marie), (e) => e.status === 429 && e.body.error === 'RESEND_TOO_SOON' && e.body.retryInSeconds === 18 && e.body.message === 'Nouvel envoi possible dans 18 s.');
  assert.equal(h.mailer.sent.length, 1);
  for (let sent = 2; sent <= 5; sent += 1) {
    h.now.advance(60 * 1000);
    const out = await h.twoFactor.sendCode(marie);
    assert.equal(out.resendInSeconds, 60);
    assert.equal(h.mailer.sent.length, sent);
  }
  h.now.advance(60 * 1000);
  await assert.rejects(h.twoFactor.sendCode(marie), (e) => e.status === 429 && e.body.error === 'TOO_MANY_SENDS');
  assert.equal(h.mailer.sent.length, 5);
  const newest = /Code : (\d{6})/.exec(h.mailer.sent[4].text)[1];
  assert.ok(h.twoFactor.confirm(marie, { code: newest }).status.enabled, 'the latest code is the one that counts');
});

test('rule 40 — cancel drops the enrolment in progress and nothing else', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD });
  assert.equal(h.twoFactor.cancel(marie), undefined);
  const row = h.twoFactorModel.get(marie.id);
  assert.equal(row.pendingMethod, null);
  assert.equal(row.pendingSecretEncrypted, null);
  assert.equal(row.pendingStartedAt, null);
  assert.equal(h.twoFactor.status(marie).enabled, false);
  assert.equal(h.twoFactor.status(marie).events.length, 0, 'the journal says nothing');
});

test('rule 40 — cancelling an enrolment never touches an active step or its email code', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  h.twoFactor.cancel(marie);
  const row = h.twoFactorModel.get(marie.id);
  assert.equal(row.method, 'totp');
  assert.equal(row.secretEncrypted, secret);
  assert.ok(row.enabledAt);
  assert.equal(h.twoFactorModel.unusedBackupCodes(marie.id).length, 10);
});

test('rule 46 — the status words the method, its date and the backup codes; low from 3 left, not at 4', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  await enableTotp(h, marie);
  let s = h.twoFactor.status(marie);
  assert.equal(s.methodLabel, 'Appli d’authentification');
  assert.equal(s.enabledLabel, 'depuis le 08/10/2026');
  assert.equal(s.backupCodesLabel, '10 codes de secours sur 10');
  assert.equal(s.backupCodesTotal, 10);
  assert.equal(s.backupCodesLow, false);
  assert.equal(s.backupCodesWarning, null);
  assert.equal(s.reauthNeedsCode, true);
  assert.equal(s.eventsCount, 1);

  const spend = (n) => Array.from({ length: n }).forEach(() => h.twoFactorModel.useBackupCode(
    h.twoFactorModel.unusedBackupCodes(marie.id)[0].id, h.now().toISOString()));
  spend(6);
  s = h.twoFactor.status(marie);
  assert.equal(s.backupCodesLabel, '4 codes de secours sur 10');
  assert.equal(s.backupCodesLow, false, '4 left is not low');
  spend(1);
  s = h.twoFactor.status(marie);
  assert.equal(s.backupCodesLow, true, '3 left is low');
  assert.equal(s.backupCodesWarning, 'Plus que 3 codes de secours.');
  spend(2);
  assert.equal(h.twoFactor.status(marie).backupCodesWarning, 'Plus qu’un code de secours.');
  assert.equal(h.twoFactor.status(marie).backupCodesLabel, '1 code de secours sur 10');
  spend(1);
  assert.equal(h.twoFactor.status(marie).backupCodesWarning, 'Aucun code de secours.');
});

test('rule 46 — a step that is off reads as off, without labels', () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const s = h.twoFactor.status(marie);
  assert.deepEqual([s.enabled, s.methodLabel, s.enabledLabel, s.backupCodesLabel, s.backupCodesLow, s.reauthNeedsCode], [false, null, null, null, false, false]);
});

test('rule 51 — the dashboard card is named « Validation en deux étapes »', () => {
  const card = CORE_SUMMARIES['two-factor']({ nudge: true });
  assert.equal(card.title, 'Validation en deux étapes');
  assert.equal(card.detail, 'Compte protégé par le seul mot de passe.');
  assert.equal(CORE_SUMMARIES['two-factor']({ nudge: false }), null);
});

test('rule 38 — the journal words the step as « Validation en deux étapes »', async () => {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { EVENT_LABELS } = require('../controllers/twoFactorController');
  assert.equal(EVENT_LABELS.enabled_totp(), 'Validation en deux étapes activée (appli)');
  assert.equal(EVENT_LABELS.enabled_email(), 'Validation en deux étapes activée (email)');
  assert.equal(EVENT_LABELS.disabled(), 'Validation en deux étapes désactivée');
  assert.equal(EVENT_LABELS.disabled_by_admin('Paul'), 'Validation en deux étapes désactivée par Paul');
  assert.equal(EVENT_LABELS.disabled_by_script(), 'Validation en deux étapes désactivée en ligne de commande');
  assert.equal(marie.email, 'marie@domaine-ombre.fr');
});

test('rules 43-44, 54-55 (§5) — the new columns are added to an existing table, twice over, without touching its rows', () => {
  const Database = require('better-sqlite3');
  const { applyAccountSecuritySchema } = require('../utils/accountSecuritySchema');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL DEFAULT '', lastName TEXT NOT NULL DEFAULT '', mustChangePassword INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role));
    CREATE TABLE user_two_factor (userId INTEGER PRIMARY KEY, method TEXT, secretEncrypted TEXT, enabledAt TEXT,
      pendingMethod TEXT, pendingSecretEncrypted TEXT, pendingFailures INTEGER NOT NULL DEFAULT 0,
      emailCodeHash TEXT, emailCodeExpiresAt TEXT, failedCount INTEGER NOT NULL DEFAULT 0, lockedUntil TEXT, lastTotpStep INTEGER);
    INSERT INTO users (id, email, passwordHash) VALUES (1, 'a@b.fr', 'x');
    INSERT INTO user_two_factor (userId, method, enabledAt, pendingMethod) VALUES (1, 'totp', '2026-10-01T00:00:00.000Z', 'totp');
  `);
  applyAccountSecuritySchema(db);
  applyAccountSecuritySchema(db);
  const row = db.prepare('SELECT * FROM user_two_factor WHERE userId = 1').get();
  assert.equal(row.method, 'totp');
  assert.equal(row.pendingMethod, 'totp');
  assert.equal(row.pendingStartedAt, null, 'reads as expired (rule 43)');
  assert.equal(row.pendingSends, 0);
  assert.equal(row.lastCodeSentAt, null);
  assert.equal(row.pendingTokenHash, null);
  assert.equal(row.actionCodeHash, null);
  assert.equal(row.mailsSent, 0);
  assert.equal(row.loginMailsSent, 0);
});
