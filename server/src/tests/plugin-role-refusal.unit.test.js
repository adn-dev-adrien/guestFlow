// specs/plugins-phase-0-foundation.md rule 29 — a role a plugin brings (Accueil ← sas, Comptable ←
// accounting-export) cannot be given while that plugin is not live: the client hides it (rule 16), the
// server refuses it. Found by the bare-install E2E run: POST /api/users took `reception` on an
// instance without the sas plugin.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/usersController');
const { ROLE_PLUGINS, SAS, ACCOUNTING_EXPORT } = require('../constants/plugins');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function subject({ live = [], users = [] } = {}) {
  const created = [];
  const updated = [];
  const sent = [];
  const usersModel = {
    findById: (id) => users.find((u) => u.id === Number(id)) || null,
    findActiveAdminCount: () => 2,
    countActive: () => users.length,
    createUser: (payload) => { created.push(payload); return { id: 99, ...payload }; },
    updateUser: (id, patch) => { updated.push({ id, patch }); return { id, ...patch }; },
  };
  const settingsModel = {
    smtpConfigured: () => true,
    publicUrl: () => 'https://gf.example',
    decryptedSmtpSettings: () => ({ fromName: 'GF' }),
  };
  const controller = buildController({
    usersModel,
    settingsModel,
    emailService: { async send(p) { sent.push(p); } },
    emailTemplates: { welcomeEmailBody: () => ({ subject: 's', text: 't' }) },
    passwordGenerator: () => 'Temp12345678',
    planQuota: () => null,
    sessionsModel: { revokeAllForUser() {} },
    isPluginLive: (id) => live.includes(id),
  });
  return { controller, created, updated, sent };
}

const body = (roles) => ({ firstName: 'Anna', lastName: 'Martin', email: 'anna@example.org', roles });

test('the two roles a plugin brings, and which plugin', () => {
  assert.deepEqual({ ...ROLE_PLUGINS }, { reception: SAS, accountant: ACCOUNTING_EXPORT });
});

test('create: Accueil without the sas plugin → 400 ROLE_PLUGIN_INACTIVE, no email, no account', async () => {
  const { controller, created, sent } = subject();
  const res = fakeRes();
  await controller.create({ body: body(['reception']), user: { id: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'ROLE_PLUGIN_INACTIVE', field: 'roles', role: 'reception', plugin: SAS });
  assert.equal(sent.length, 0);
  assert.equal(created.length, 0);
});

test('create: Comptable without the accounting export → refused, even beside admin', async () => {
  const { controller } = subject({ live: [SAS] });
  const res = fakeRes();
  await controller.create({ body: body(['admin', 'accountant']), user: { id: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.plugin, ACCOUNTING_EXPORT);
});

test('create: the role is given once its plugin is live; admin never depends on a plugin', async () => {
  const { controller, created } = subject({ live: [SAS] });
  const reception = fakeRes();
  await controller.create({ body: body(['reception']), user: { id: 1 } }, reception);
  assert.equal(reception.statusCode, 201);
  const admin = fakeRes();
  await controller.create({ body: { ...body(['admin']), email: 'b@example.org' }, user: { id: 1 } }, admin);
  assert.equal(admin.statusCode, 201);
  assert.equal(created.length, 2);
});

test('update: adding Accueil without sas is refused; a role already held is kept', () => {
  const users = [
    { id: 5, roles: ['admin'], isActive: true },
    { id: 6, roles: ['admin', 'accountant'], isActive: true },
  ];
  const { controller, updated } = subject({ users });
  const adding = fakeRes();
  controller.update({ params: { id: '5' }, body: { roles: ['admin', 'reception'] }, user: { id: 1 } }, adding);
  assert.equal(adding.statusCode, 400);
  assert.equal(adding.body.error, 'ROLE_PLUGIN_INACTIVE');
  const keeping = fakeRes();
  controller.update({ params: { id: '6' }, body: { roles: ['admin', 'accountant'], firstName: 'Léa' }, user: { id: 1 } }, keeping);
  assert.equal(keeping.statusCode, 200);
  assert.equal(updated.length, 1);
});
