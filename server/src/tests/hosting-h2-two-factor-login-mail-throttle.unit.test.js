// specs/hosting-h2-account-security.md rule 62 (audit of 2026-10-28, finding L3) — the code mailed at
// an email-method login takes a mail slot like every other code mail (rule 55): a right password
// repeated does not mail-bomb the owner. No real mail: the fixture's mailer only records.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./accountSecurityFixture');

const PASSWORD = 'correct horse battery';

async function emailAccount(h, address = 'marie@domaine-ombre.fr') {
  const user = h.addUser(address);
  await h.twoFactor.start(user, { method: 'email', password: PASSWORD });
  const code = /Code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
  h.twoFactor.confirm(user, { code });
  h.now.advance(2 * 60000);
  h.mailer.sent.length = 0;
  return user;
}

test('rule 62 — a second login within the gap, code still live: no second mail, the step is shown on the code sent', async () => {
  const h = setup();
  const user = await emailAccount(h);
  const first = await h.twoFactor.beginLogin(user);
  assert.equal(first.step, 'second-factor');
  assert.equal(h.mailer.sent.length, 1);
  h.now.advance(5000);
  const again = await h.twoFactor.beginLogin(user);
  assert.equal(again.step, 'second-factor');
  assert.match(again.message, /Code déjà envoyé/);
  assert.equal(h.mailer.sent.length, 1, 'no new mail');
});

test('rule 62 — case A: a login within 60 s of a SUCCESSFUL one has no live code, so it is refused with the wait', async () => {
  const h = setup();
  const user = await emailAccount(h);
  await h.twoFactor.beginLogin(user);
  const code = /Code : (\d{6})/.exec(h.mailer.sent[0].text)[1];
  h.twoFactor.verifyLogin(user.id, { code });
  h.now.advance(10000);
  await assert.rejects(h.twoFactor.beginLogin(user), (e) => e.status === 429 && e.body.error === 'RESEND_TOO_SOON'
    && e.body.retryInSeconds > 0 && /Nouvel envoi possible dans \d+ s/.test(e.body.message));
  assert.equal(h.mailer.sent.length, 1, 'no new mail');
  h.now.advance(61000);
  assert.equal((await h.twoFactor.beginLogin(user)).step, 'second-factor');
  assert.equal(h.mailer.sent.length, 2);
});

test('rule 62 — case B: six logins in an hour use the budget; the 7th with no live code says « Trop d’envois »', async () => {
  const h = setup();
  const user = await emailAccount(h);
  for (let i = 0; i < 6; i += 1) {
    await h.twoFactor.beginLogin(user);
    const code = /Code : (\d{6})/.exec(h.mailer.sent[h.mailer.sent.length - 1].text)[1];
    h.twoFactor.verifyLogin(user.id, { code });
    h.now.advance(61000);
  }
  assert.equal(h.mailer.sent.length, 6);
  await assert.rejects(h.twoFactor.beginLogin(user), (e) => e.status === 429 && e.body.error === 'TOO_MANY_SENDS');
  assert.equal(h.mailer.sent.length, 6, 'no seventh mail');
});

test('rule 62 — the login mail and « Renvoyer le code » share the slot: no resend right after a login mail', async () => {
  const h = setup();
  const user = await emailAccount(h);
  await h.twoFactor.beginLogin(user);
  await assert.rejects(h.twoFactor.resendLogin(user.id), (e) => e.status === 429);
  h.now.advance(61000);
  await h.twoFactor.resendLogin(user.id);
  assert.equal(h.mailer.sent.length, 2);
});

test('rule 62 — an app-method login mails nothing', async () => {
  const h = setup();
  const user = h.addUser('paul@domaine-ombre.fr');
  const { enableTotp } = require('./accountSecurityFixture');
  await enableTotp(h, user);
  h.mailer.sent.length = 0;
  await h.twoFactor.beginLogin(user);
  assert.equal(h.mailer.sent.length, 0);
});
