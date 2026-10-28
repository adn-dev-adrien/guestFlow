// specs/hosting-h2-account-security.md rules 48 and 50 (UX review of 2026-10-28) — changing the
// authenticator app (or moving between the app and the email code) never leaves the account
// unprotected: the current method keeps working until a code from the new one is confirmed, and the
// swap of method, secret and backup codes is one transaction that keeps the trusted devices trusted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp } = require('./accountSecurityFixture');

const PASSWORD = 'correct horse battery';
const SESSION = { sessionId: 'sid-marie' };
const MIN = 60000;
const emailedCode = (h) => /Code : (\d{6})/.exec(h.mailer.sent.at(-1).text)[1];

async function replacing() {
  const h = setup();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const old = await enableTotp(h, marie);
  h.now.advance(MIN);
  const started = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD, code: codeAt(old.secret, h.now()) }, SESSION);
  return { h, marie, old, started, fresh: started.secret.replace(/\s/g, '') };
}

test('rule 48 — while a new app is pending, the old method still opens a session and the card stays on', async () => {
  const { h, marie, old, started, fresh } = await replacing();
  assert.equal(started.replacing, true);
  assert.equal(h.twoFactor.status(marie).enabled, true);
  assert.equal(h.twoFactor.isRequired(marie, ''), true);
  h.now.advance(30000);
  assert.ok(h.twoFactor.verifyLogin(marie.id, { code: codeAt(old.secret, h.now()) }).user, 'the old app is still accepted');
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: codeAt(fresh, h.now()) }), (e) => e.body.error === 'BAD_CODE', 'the new one is not yet');
});

test('rule 48 — confirming a code from the new app swaps method, secret and backup codes and keeps enabledAt', async () => {
  const { h, marie, old, fresh } = await replacing();
  const before = h.twoFactorModel.get(marie.id);
  const trust = h.twoFactor.issueTrust(marie.id);
  const oldCodes = h.twoFactorModel.unusedBackupCodes(marie.id).map((r) => r.id);
  h.now.advance(30000);
  const done = h.twoFactor.confirm(marie, { code: codeAt(fresh, h.now()) });
  const after = h.twoFactorModel.get(marie.id);
  assert.equal(after.enabledAt, before.enabledAt, 'enabledAt is kept');
  assert.equal(after.secretEncrypted, fresh);
  assert.notEqual(after.secretEncrypted, old.secret);
  assert.equal(after.pendingMethod, null);
  assert.equal(done.backupCodes.length, 10);
  const newCodes = h.twoFactorModel.unusedBackupCodes(marie.id).map((r) => r.id);
  assert.equal(newCodes.length, 10);
  assert.ok(newCodes.every((id) => !oldCodes.includes(id)), 'the old backup codes are gone');
  assert.equal(h.twoFactor.isRequired(marie, trust.value), false, 'a trusted device stays trusted');
  h.now.advance(30000);
  assert.throws(() => h.twoFactor.verifyLogin(marie.id, { code: codeAt(old.secret, h.now()) }), (e) => e.body.error === 'BAD_CODE', 'the old app stops');
  assert.ok(h.twoFactor.verifyLogin(marie.id, { code: codeAt(fresh, h.now()) }).user);
});

test('rule 48 — a wrong code, a cancel or an expiry keeps the current method untouched', async () => {
  const { h, marie, old, fresh } = await replacing();
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  h.twoFactor.cancel(marie);
  let row = h.twoFactorModel.get(marie.id);
  assert.deepEqual([row.method, row.secretEncrypted, row.pendingMethod], ['totp', old.secret, null]);
  assert.equal(h.twoFactorModel.unusedBackupCodes(marie.id).length, 10);
  assert.throws(() => h.twoFactor.confirm(marie, { code: codeAt(fresh, h.now()) }), (e) => e.body.error === 'NO_PENDING_METHOD');

  h.now.advance(MIN);
  await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD, code: codeAt(old.secret, h.now()) }, SESSION);
  h.now.advance(16 * MIN);
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'ENROLMENT_EXPIRED');
  row = h.twoFactorModel.get(marie.id);
  assert.deepEqual([row.method, row.secretEncrypted, row.pendingMethod], ['totp', old.secret, null]);
});

test('rule 48 — five wrong codes drop the replacement, not the step', async () => {
  const { h, marie, old } = await replacing();
  for (let i = 0; i < 4; i += 1) assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'BAD_CODE');
  assert.throws(() => h.twoFactor.confirm(marie, { code: '000000' }), (e) => e.body.error === 'TOO_MANY_CODES');
  assert.equal(h.twoFactor.status(marie).enabled, true);
  assert.equal(h.twoFactorModel.get(marie.id).secretEncrypted, old.secret);
});

test('rules 48 + 50 — from the app to the email code, and back: on all along, and the journal names each move', async () => {
  const { h, marie, old } = await replacing();
  const toEmail = await h.twoFactor.start(marie, { method: 'email' }, SESSION);
  assert.equal(toEmail.replacing, true);
  assert.equal(h.twoFactorModel.get(marie.id).method, 'totp', 'the app still protects the account until the code is confirmed');
  h.twoFactor.confirm(marie, { code: emailedCode(h) });
  let row = h.twoFactorModel.get(marie.id);
  assert.deepEqual([row.method, row.secretEncrypted], ['email', null]);
  assert.equal(h.twoFactor.status(marie).methodLabel, 'Code par email');
  assert.equal(h.twoFactor.status(marie).events[0].label, 'Passage au code par email');

  await assert.rejects(h.twoFactor.start(marie, { method: 'email', password: PASSWORD, code: '000000' }, SESSION), (e) => e.body.error === 'SAME_METHOD', 'already by email');
  h.now.advance(MIN);
  await h.twoFactor.sendCode(marie);
  const back = await h.twoFactor.start(marie, { method: 'totp', password: PASSWORD, code: emailedCode(h) }, SESSION);
  h.twoFactor.confirm(marie, { code: codeAt(back.secret.replace(/\s/g, ''), h.now()) });
  row = h.twoFactorModel.get(marie.id);
  assert.equal(row.method, 'totp');
  assert.notEqual(row.secretEncrypted, old.secret);
  assert.equal(h.twoFactor.status(marie).events[0].label, 'Appli d’authentification changée');
});

test('rule 50 — the new journal labels and the first activation\'s stay distinct', async () => {
  const { h, marie, fresh } = await replacing();
  h.now.advance(30000);
  h.twoFactor.confirm(marie, { code: codeAt(fresh, h.now()) });
  const labels = h.twoFactor.status(marie).events.map((e) => e.label);
  assert.equal(labels[0], 'Appli d’authentification changée');
  assert.ok(labels.includes('Validation en deux étapes activée (appli)'));
});
