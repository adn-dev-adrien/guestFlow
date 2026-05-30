const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/usersController');

// Pure-controller tests with hand-rolled fakes for usersModel + settingsModel + emailService +
// passwordGenerator. We verify the orchestration rules from specs/admin-account-management.md:
//   - create / reset send the email BEFORE persisting; on email failure NOTHING is persisted
//   - SMTP-not-configured + public-url-not-configured short-circuit with 400
//   - the temporary password is never returned in the response
//   - self-action + last-admin + hard-delete-eligibility guards
//   - input validation (required fields, known roles, email format)

function makeFakeUsersModel({ initialUsers = [], adminCount = 1 } = {}) {
  const calls = [];
  const users = new Map(initialUsers.map((u) => [u.id, { ...u }]));
  let nextId = (initialUsers.reduce((m, u) => Math.max(m, u.id), 0) || 0) + 1;
  return {
    calls,
    list() { return [...users.values()]; },
    findById(id) { return users.get(Number(id)) || null; },
    createUser(payload) {
      calls.push({ fn: 'createUser', payload });
      const user = {
        id: nextId++,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        companyName: payload.companyName,
        notes: payload.notes,
        roles: [...payload.roles],
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: null,
      };
      users.set(user.id, user);
      return user;
    },
    updateUser(id, payload) {
      calls.push({ fn: 'updateUser', id, payload });
      const existing = users.get(Number(id));
      if (!existing) return null;
      const updated = { ...existing, ...payload };
      if (Array.isArray(payload.roles)) updated.roles = [...payload.roles];
      users.set(Number(id), updated);
      return updated;
    },
    resetUserPassword(id, password) {
      calls.push({ fn: 'resetUserPassword', id, password });
      const u = users.get(Number(id));
      if (!u) return null;
      u.mustChangePassword = true;
      return u;
    },
    softDelete(id) {
      calls.push({ fn: 'softDelete', id });
      const u = users.get(Number(id));
      if (u) u.isActive = false;
      return u || null;
    },
    hardDelete(id) {
      calls.push({ fn: 'hardDelete', id });
      const u = users.get(Number(id));
      if (!u) return null;
      const eligible = u.lastLoginAt == null && u.mustChangePassword;
      if (!eligible) {
        const err = new Error('HARD_DELETE_NOT_ELIGIBLE');
        err.code = 'HARD_DELETE_NOT_ELIGIBLE';
        throw err;
      }
      users.delete(Number(id));
      return true;
    },
    findActiveAdminCount() { return adminCount; },
  };
}

function makeFakeSettingsModel({ smtpConfigured = true, publicUrl = 'https://example.com' } = {}) {
  return {
    smtpConfigured: () => smtpConfigured,
    publicUrl: () => publicUrl,
    decryptedSmtpSettings: () => ({ host: 'smtp.example.com', port: 587, secure: false, user: '', password: '', fromEmail: 'a@b.c', fromName: 'GF' }),
  };
}

function makeFakeEmailService({ failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    isConfigured: true,
    async send(payload) {
      sent.push(payload);
      if (failWith) throw failWith;
      return { messageId: 'fake' };
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

// Captures every argument the controller passes to the templates, so a test can assert that
// `fromName` flows from settingsModel → controller → template (the signature change Adrien asked
// for: emails now sign with the SMTP sender name + the auto-generated notice).
const templateCalls = { welcome: [], reset: [] };
const fakeEmailTemplates = {
  welcomeEmailBody: (args) => { templateCalls.welcome.push(args); return { subject: 'welcome', text: `${args.email}|${args.temporaryPassword}|${args.fromName}` }; },
  passwordResetEmailBody: (args) => { templateCalls.reset.push(args); return { subject: 'reset', text: `${args.email}|${args.temporaryPassword}|${args.fromName}` }; },
};
const fakePasswordGenerator = () => 'FakeTemp1234';

function buildSubject({ usersModel, settingsModel, emailService = makeFakeEmailService(), passwordGenerator = fakePasswordGenerator } = {}) {
  return buildController({
    usersModel,
    settingsModel,
    emailService,
    emailTemplates: fakeEmailTemplates,
    passwordGenerator,
  });
}

// ----- create -----

test('create: sends the email then persists the user; response carries the safe user, no temp password', async () => {
  templateCalls.welcome = [];
  const usersModel = makeFakeUsersModel();
  const emailService = makeFakeEmailService();
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel(), emailService });

  const req = {
    body: { firstName: 'Marie', lastName: 'Dupont', email: 'marie@example.org', roles: ['accountant'] },
    user: { id: 1, roles: ['admin'] },
  };
  const res = fakeRes();
  await c.create(req, res);

  assert.equal(res.statusCode, 201);
  assert.ok(res.body.user);
  assert.equal(res.body.user.email, 'marie@example.org');
  assert.equal(res.body.temporaryPassword, undefined, 'temp password must never leak in the response');

  // Email was sent before the model write (the only persisted call is createUser).
  assert.equal(emailService.sent.length, 1);
  assert.equal(emailService.sent[0].to, 'marie@example.org');
  assert.deepEqual(usersModel.calls.map((c) => c.fn), ['createUser']);
  assert.equal(usersModel.calls[0].payload.password, 'FakeTemp1234');

  // fromName flows from settingsModel.decryptedSmtpSettings() to the welcome template so the
  // email signs with the configured sender name (Adrien feedback 2026-05-30).
  assert.equal(templateCalls.welcome.length, 1);
  assert.equal(templateCalls.welcome[0].fromName, 'GF');
});

test('resetPassword: passes fromName to the reset template (signature consistency)', async () => {
  templateCalls.reset = [];
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 7, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }] });
  const emailService = makeFakeEmailService();
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel(), emailService });
  const req = { params: { id: 7 }, body: {}, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  await c.resetPassword(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(templateCalls.reset.length, 1);
  assert.equal(templateCalls.reset[0].fromName, 'GF');
});

test('create: email send failure → 502 EMAIL_SEND_FAILED, model NEVER called', async () => {
  const usersModel = makeFakeUsersModel();
  const emailService = makeFakeEmailService({ failWith: new Error('5.7.8 auth failed') });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel(), emailService });
  const req = { body: { firstName: 'A', lastName: 'B', email: 'x@y.z', roles: ['accountant'] }, user: { id: 1 } };
  const res = fakeRes();
  await c.create(req, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'EMAIL_SEND_FAILED');
  assert.ok(/auth failed/.test(res.body.detail));
  assert.equal(usersModel.calls.length, 0, 'no user persisted');
});

test('create: 400 SMTP_NOT_CONFIGURED when SMTP is unset (no email attempted)', async () => {
  const usersModel = makeFakeUsersModel();
  const emailService = makeFakeEmailService();
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel({ smtpConfigured: false }), emailService });
  const req = { body: { firstName: 'A', lastName: 'B', email: 'x@y.z', roles: ['accountant'] }, user: { id: 1 } };
  const res = fakeRes();
  await c.create(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMTP_NOT_CONFIGURED');
  assert.equal(emailService.sent.length, 0);
  assert.equal(usersModel.calls.length, 0);
});

test('create: 400 PUBLIC_URL_NOT_CONFIGURED when publicUrl is empty', async () => {
  const c = buildSubject({
    usersModel: makeFakeUsersModel(),
    settingsModel: makeFakeSettingsModel({ publicUrl: '' }),
  });
  const req = { body: { firstName: 'A', lastName: 'B', email: 'x@y.z', roles: ['accountant'] }, user: { id: 1 } };
  const res = fakeRes();
  await c.create(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PUBLIC_URL_NOT_CONFIGURED');
});

test('create: 400 on missing firstName / lastName / invalid email / empty roles / unknown role', async () => {
  const c = buildSubject({ usersModel: makeFakeUsersModel(), settingsModel: makeFakeSettingsModel() });
  for (const body of [
    { firstName: '', lastName: 'B', email: 'x@y.z', roles: ['accountant'] },
    { firstName: 'A', lastName: '', email: 'x@y.z', roles: ['accountant'] },
    { firstName: 'A', lastName: 'B', email: 'not-an-email', roles: ['accountant'] },
    { firstName: 'A', lastName: 'B', email: 'x@y.z', roles: [] },
    { firstName: 'A', lastName: 'B', email: 'x@y.z', roles: ['superuser'] },
  ]) {
    const res = fakeRes();
    await c.create({ body, user: { id: 1 } }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('create: duplicate email surfaced as 409 EMAIL_ALREADY_EXISTS', async () => {
  const usersModel = makeFakeUsersModel();
  // Replace createUser with a thrower simulating the model's UNIQUE wrapping.
  usersModel.createUser = () => { const e = new Error('EMAIL_ALREADY_EXISTS'); e.code = 'EMAIL_ALREADY_EXISTS'; throw e; };
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const req = { body: { firstName: 'A', lastName: 'B', email: 'dup@x.y', roles: ['accountant'] }, user: { id: 1 } };
  const res = fakeRes();
  await c.create(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'EMAIL_ALREADY_EXISTS');
});

// ----- update -----

test('update: rewrites identity + roles; passes through to model', async () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 7, firstName: 'X', lastName: 'Y', email: 'x@y.z', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: null }] });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const req = { params: { id: 7 }, body: { firstName: 'Marie', roles: ['accountant'] }, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  c.update(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.firstName, 'Marie');
});

test('update: self trying to remove their own admin role → 403 SELF_ACTION_FORBIDDEN', () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin', 'accountant'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }], adminCount: 2 });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const req = { params: { id: 1 }, body: { roles: ['accountant'] }, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  c.update(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'SELF_ACTION_FORBIDDEN');
});

test('update: stripping admin from another user → 400 LAST_ADMIN when count would drop to 0', () => {
  const usersModel = makeFakeUsersModel({
    initialUsers: [{ id: 7, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }],
    adminCount: 1,
  });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const req = { params: { id: 7 }, body: { roles: ['accountant'] }, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  c.update(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'LAST_ADMIN');
});

// ----- resetPassword -----

test('resetPassword: sends email then persists the new password (model called only on success)', async () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 7, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }] });
  const emailService = makeFakeEmailService();
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel(), emailService });
  const req = { params: { id: 7 }, body: {}, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  await c.resetPassword(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(emailService.sent.length, 1);
  assert.deepEqual(usersModel.calls.map((c) => c.fn), ['resetUserPassword']);
});

test('resetPassword: email failure → 502, password NOT changed', async () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 7, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }] });
  const emailService = makeFakeEmailService({ failWith: new Error('Connection refused') });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel(), emailService });
  const req = { params: { id: 7 }, body: {}, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  await c.resetPassword(req, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'EMAIL_SEND_FAILED');
  assert.equal(usersModel.calls.length, 0, 'password preserved');
});

test('resetPassword: self → 403 SELF_ACTION_FORBIDDEN', async () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }] });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const req = { params: { id: 1 }, body: {}, user: { id: 1, roles: ['admin'] } };
  const res = fakeRes();
  await c.resetPassword(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'SELF_ACTION_FORBIDDEN');
});

// ----- softDelete / hardDelete -----

test('softDelete: self → 403; happy path → 204 and isActive flipped via model', () => {
  const usersModel = makeFakeUsersModel({
    initialUsers: [
      { id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' },
      { id: 2, firstName: 'C', lastName: 'D', email: 'c@d.e', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: null },
    ],
    adminCount: 1,
  });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });

  const selfRes = fakeRes();
  c.softDelete({ params: { id: 1 }, user: { id: 1, roles: ['admin'] } }, selfRes);
  assert.equal(selfRes.statusCode, 403);

  const otherRes = fakeRes();
  c.softDelete({ params: { id: 2 }, user: { id: 1, roles: ['admin'] } }, otherRes);
  assert.equal(otherRes.statusCode, 204);
});

test('softDelete: deactivating the last active admin → 400 LAST_ADMIN', () => {
  const usersModel = makeFakeUsersModel({
    initialUsers: [
      { id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' },
      { id: 2, firstName: 'C', lastName: 'D', email: 'c@d.e', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' },
    ],
    adminCount: 1,
  });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const res = fakeRes();
  // Caller is user 2; attempting to deactivate user 1 who is the only counted active admin.
  c.softDelete({ params: { id: 1 }, user: { id: 2, roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'LAST_ADMIN');
});

test('hardDelete: eligible → 204; ineligible → 400 HARD_DELETE_NOT_ELIGIBLE', () => {
  const usersModel = makeFakeUsersModel({
    initialUsers: [
      { id: 2, firstName: 'New', lastName: 'User', email: 'n@u.c', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: true, lastLoginAt: null },
      { id: 3, firstName: 'Old', lastName: 'User', email: 'o@u.c', companyName: '', notes: '', roles: ['accountant'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' },
    ],
  });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });

  const eligibleRes = fakeRes();
  c.hardDelete({ params: { id: 2 }, user: { id: 1, roles: ['admin'] } }, eligibleRes);
  assert.equal(eligibleRes.statusCode, 204);

  const ineligibleRes = fakeRes();
  c.hardDelete({ params: { id: 3 }, user: { id: 1, roles: ['admin'] } }, ineligibleRes);
  assert.equal(ineligibleRes.statusCode, 400);
  assert.equal(ineligibleRes.body.error, 'HARD_DELETE_NOT_ELIGIBLE');
});

test('hardDelete: self → 403', () => {
  const usersModel = makeFakeUsersModel({
    initialUsers: [{ id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: true, lastLoginAt: null }],
  });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const res = fakeRes();
  c.hardDelete({ params: { id: 1 }, user: { id: 1, roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 403);
});

// ----- getMe -----

test('getMe: returns the safe user from the model (re-fetched)', () => {
  const usersModel = makeFakeUsersModel({ initialUsers: [{ id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', companyName: '', notes: '', roles: ['admin'], isActive: true, mustChangePassword: false, lastLoginAt: '2026-05-30' }] });
  const c = buildSubject({ usersModel, settingsModel: makeFakeSettingsModel() });
  const res = fakeRes();
  c.getMe({ user: { id: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.email, 'a@b.c');
});
