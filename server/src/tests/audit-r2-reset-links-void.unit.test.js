// specs/hosting-h2-account-security.md rule 63 (audit R2, finding N2) — a reset link mailed before an
// email or password change does not work after it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./accountSecurityFixture');

function withOpenLink() {
  const h = setup();
  const user = h.addUser('marie@domaine-ombre.fr');
  const other = h.addUser('autre@domaine-ombre.fr');
  const nowIso = h.now().toISOString();
  const expires = new Date(h.now().getTime() + 3600000).toISOString();
  h.passwordResetModel.create(user.id, 'hash-user', expires, nowIso);
  h.passwordResetModel.create(other.id, 'hash-other', expires, nowIso);
  const usable = (hash) => Boolean(h.passwordResetModel.findUsable(hash, nowIso));
  return { ...h, user, other, usable };
}

test('rule 63 — an email change voids the user\'s open reset links, and only theirs', () => {
  const w = withOpenLink();
  assert.equal(w.usable('hash-user'), true);
  w.users.updateUser(w.user.id, { email: 'nouvelle@domaine-ombre.fr' });
  assert.equal(w.usable('hash-user'), false);
  assert.equal(w.usable('hash-other'), true);
});

test('rule 63 — a save that keeps the email leaves the link alone', () => {
  const w = withOpenLink();
  w.users.updateUser(w.user.id, { firstName: 'Marie' });
  assert.equal(w.usable('hash-user'), true);
});

test('rule 63 — a password change voids the open reset links', () => {
  const w = withOpenLink();
  w.users.updatePassword(w.user.id, 'a brand new password');
  assert.equal(w.usable('hash-user'), false);
  assert.equal(w.usable('hash-other'), true);
});

test('rule 63 — an administrator\'s reset voids the open reset links', () => {
  const w = withOpenLink();
  w.users.resetUserPassword(w.user.id, 'temporary password 1');
  assert.equal(w.usable('hash-user'), false);
  assert.equal(w.usable('hash-other'), true);
});
