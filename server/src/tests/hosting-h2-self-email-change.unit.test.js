// specs/hosting-h2-account-security.md rule 59 (audit of 2026-10-28, finding M1) — changing your own
// email asks the current password, and a current code when the second step is on; the old address is
// told. A name-only save asks nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, codeAt, enableTotp, fakeRes } = require('./accountSecurityFixture');
const { buildController } = require('../controllers/usersController');

const PASSWORD = 'correct horse battery';

function harness() {
  const h = setup();
  const sent = [];
  const emailService = { async send(mail) { sent.push(mail); } };
  const controller = buildController({ usersModel: h.users, settingsModel: {}, emailService, twoFactor: h.twoFactor });
  const call = (user, body) => {
    const res = fakeRes();
    const session = { user };
    controller.updateSelf({ user, session, body: { firstName: 'Marie', lastName: 'D', ...body } }, res);
    return { res, session };
  };
  return { h, sent, call };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('rule 59 — an email change without the password is refused and changes nothing', () => {
  const { h, sent, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { res } = call(marie, { email: 'attaquant@example.invalid' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'BAD_PASSWORD');
  assert.equal(h.users.findById(marie.id).email, 'marie@domaine-ombre.fr');
  assert.equal(sent.length, 0);
});

test('rule 59 — a wrong password is refused and counts toward the shared lock of rule 49', () => {
  const { h, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  for (let i = 0; i < 4; i += 1) {
    assert.equal(call(marie, { email: 'x@example.invalid', currentPassword: 'nope' }).res.body.error, 'BAD_PASSWORD');
  }
  const locked = call(marie, { email: 'x@example.invalid', currentPassword: 'nope' }).res;
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.body.error, 'REAUTH_LOCKED');
  assert.equal(call(marie, { email: 'x@example.invalid', currentPassword: PASSWORD }).res.statusCode, 429, 'even the right password waits');
  assert.equal(h.users.findById(marie.id).email, 'marie@domaine-ombre.fr');
});

test('rule 59 — with the password and no second step, the email changes and the OLD address is told', async () => {
  const { h, sent, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { res, session } = call(marie, { email: 'marie@nouveau.fr', currentPassword: PASSWORD });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.email, 'marie@nouveau.fr');
  assert.equal(session.user.email, 'marie@nouveau.fr');
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'marie@domaine-ombre.fr');
  assert.match(sent[0].text, /marie@nouveau\.fr/);
});

test('rule 59 — with the second step on, a current code is required on top of the password', async () => {
  const { h, sent, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { secret } = await enableTotp(h, marie);
  h.now.advance(60000);
  const noCode = call(marie, { email: 'marie@nouveau.fr', currentPassword: PASSWORD }).res;
  assert.equal(noCode.statusCode, 400);
  assert.equal(noCode.body.error, 'CODE_REQUIRED');
  const bad = call(marie, { email: 'marie@nouveau.fr', currentPassword: PASSWORD, code: '000000' }).res;
  assert.equal(bad.body.error, 'BAD_CODE');
  assert.equal(h.users.findById(marie.id).email, 'marie@domaine-ombre.fr');
  const ok = call(marie, { email: 'marie@nouveau.fr', currentPassword: PASSWORD, code: codeAt(secret, h.now()) }).res;
  assert.equal(ok.statusCode, 200);
  await tick();
  assert.equal(sent[0].to, 'marie@domaine-ombre.fr');
});

test('rule 59 — a save that leaves the email as it is asks for nothing', () => {
  const { h, sent, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  const { res } = call(marie, { email: 'Marie@Domaine-Ombre.fr', lastName: 'Dupont' });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0);
});

test('rule 59 — a malformed or taken address is refused before the password is spent', () => {
  const { h, call } = harness();
  const marie = h.addUser('marie@domaine-ombre.fr');
  h.addUser('paul@domaine-ombre.fr');
  assert.equal(call(marie, { email: 'pas-une-adresse' }).res.body.error, 'INVALID_EMAIL');
  const taken = call(marie, { email: 'paul@domaine-ombre.fr', currentPassword: PASSWORD }).res;
  assert.equal(taken.statusCode, 409);
});
