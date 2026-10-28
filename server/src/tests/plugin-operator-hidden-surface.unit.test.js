// specs/plugin-operator-provisioning.md rules 3–9 — on an operator-managed space the plugin lifecycle
// does not exist (the exact unknown-route 404, for every role, a support session included), the list
// is narrowed to what a feature needs, the assistant has no plugin step; an unmanaged space (Solio,
// development, E2E) is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { space } = require('./pluginOperatorFixture');
const { create: createGuard } = require('../middleware/requireSelfManagedPlugins');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');
const authController = require('../controllers/authController');
const { buildController: buildOnboarding } = require('../controllers/onboardingController');

const LIFECYCLE = [
  ['GET', '/status'], ['GET', '/page?path=/comptabilite'], ['POST', '/refresh'], ['POST', '/update-all'],
  ['POST', '/linen/install'], ['POST', '/linen/update'], ['POST', '/linen/rollback'],
  ['POST', '/linen/activate'], ['POST', '/linen/deactivate'], ['DELETE', '/linen?purge=1'],
];
const UNKNOWN = { error: 'API route not found' };

async function serve(userOf, { managed = true } = {}) {
  const previous = process.env.GUESTFLOW_MANAGED;
  if (managed) process.env.GUESTFLOW_MANAGED = '1'; else delete process.env.GUESTFLOW_MANAGED;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userOf(req);
    req.session = { user: req.user, supportAccessId: req.user.isSupport ? 7 : undefined };
    next();
  });
  app.use('/api', enforceRoleAccess);
  app.use('/api/plugins', require('../routes/plugins'));
  app.use('/api', (req, res) => res.status(404).json({ ...UNKNOWN }));
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = async (method, path) => {
    const res = await fetch(`${base}/api/plugins${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    return { status: res.status, text: await res.text() };
  };
  return {
    ask,
    close: () => new Promise((resolve) => server.close(() => {
      if (previous === undefined) delete process.env.GUESTFLOW_MANAGED; else process.env.GUESTFLOW_MANAGED = previous;
      resolve();
    })),
  };
}

const ROLES = {
  admin: { id: 1, roles: ['admin'] },
  support: { id: 2, roles: ['admin'], isSupport: true },
  reception: { id: 3, roles: ['reception'] },
  accountant: { id: 4, roles: ['accountant'] },
};

test('rule 4: every lifecycle route answers the unknown-route 404 byte for byte — admin', async () => {
  const s = await serve(() => ROLES.admin);
  try {
    const unknown = await s.ask('GET', '/zzz/none');
    assert.deepEqual(unknown, { status: 404, text: JSON.stringify(UNKNOWN) });
    for (const [method, path] of LIFECYCLE) {
      // eslint-disable-next-line no-await-in-loop
      assert.deepEqual(await s.ask(method, path), unknown, `${method} ${path}`);
    }
  } finally { await s.close(); }
});

test('rule 4: a support session gets the same answer — the operator acts from the console', async () => {
  const s = await serve(() => ROLES.support);
  try {
    const unknown = await s.ask('GET', '/zzz/none');
    for (const [method, path] of LIFECYCLE) {
      // eslint-disable-next-line no-await-in-loop
      assert.deepEqual(await s.ask(method, path), unknown, `${method} ${path}`);
    }
  } finally { await s.close(); }
});

test('rule 4: the other roles cannot tell a lifecycle route from an unknown one', async () => {
  for (const role of ['reception', 'accountant']) {
    // eslint-disable-next-line no-await-in-loop
    const s = await serve(() => ROLES[role]);
    try {
      const unknown = await s.ask('GET', '/zzz/none');
      for (const [method, path] of LIFECYCLE) {
        // eslint-disable-next-line no-await-in-loop
        assert.deepEqual(await s.ask(method, path), unknown, `${role} ${method} ${path}`);
      }
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await s.close();
    }
  }
});

test('rule 4: the guard sits before the controller on exactly the lifecycle routes', () => {
  const guard = require('../middleware/requireSelfManagedPlugins');
  const stack = require('../routes/plugins').stack.filter((l) => l.route);
  const guarded = stack.filter((l) => l.route.stack[0].handle === guard).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`).sort();
  assert.deepEqual(guarded, [
    'DELETE /:id', 'GET /page', 'GET /status', 'POST /:id/activate', 'POST /:id/deactivate', 'POST /:id/install',
    'POST /:id/rollback', 'POST /:id/update', 'POST /refresh', 'POST /update-all',
  ]);
});

test('rule 6: a plugin\'s own settings are not behind the guard — they answer on a managed space', async () => {
  const s = await serve(() => ROLES.admin);
  try {
    const answer = await s.ask('GET', '/linen/settings');
    assert.notEqual(answer.text, JSON.stringify(UNKNOWN));
    const put = await s.ask('PUT', '/linen/settings');
    assert.notEqual(put.text, JSON.stringify(UNKNOWN));
  } finally { await s.close(); }
});

test('rule 1: an unmanaged space — the guard lets every route through (Solio, development, E2E)', async () => {
  const guard = createGuard({ operatorManaged: () => false });
  let reached = 0;
  const res = { status() { throw new Error('answered'); } };
  LIFECYCLE.forEach(() => guard({}, res, () => { reached += 1; }));
  assert.equal(reached, LIFECYCLE.length);
  const answers = [];
  createGuard({ operatorManaged: () => true })({}, { status(code) { answers.push(code); return { json: (b) => answers.push(b) }; } }, () => answers.push('next'));
  assert.deepEqual(answers, [404, UNKNOWN]);
});

test('rule 5: on a managed space GET /api/plugins lists the live plugins as { id, name, icon, setup } and nothing else', () => {
  const s = space({ installed: ['linen', ['sas', false]], managed: true });
  let out;
  s.controller.list({}, { json: (b) => { out = b; } });
  assert.deepEqual(out.map((p) => p.id), ['linen']);
  assert.deepEqual(Object.keys(out[0]).sort(), ['icon', 'id', 'name', 'setup']);
  assert.equal(typeof out[0].setup.needed, 'boolean');
});

test('rule 5: a plugin that is off, not installed or not live is not listed', () => {
  const s = space({ installed: ['linen', 'neat', ['sas', false]], managed: true });
  s.controller = require('../controllers/pluginsController').createController(s.model, {
    licence: () => ({ allowsPlugin: () => true, planFor: () => null }),
    registry: { get: () => null, isLive: (id) => id !== 'neat' },
    db: () => s.db,
    operatorManaged: () => true,
  });
  let out;
  s.controller.list({}, { json: (b) => { out = b; } });
  assert.deepEqual(out.map((p) => p.id), ['linen']);
});

test('rules 5, 9: nothing about versions, plans, offers, updates or data reaches the customer', () => {
  const s = space({ installed: ['linen'], plugins: ['linen'], managed: true });
  let out;
  s.controller.list({}, { json: (b) => { out = b; } });
  const text = JSON.stringify(out);
  ['version', 'source', 'state', 'planChip', 'planHint', 'outOfPlan', 'offer', 'update', 'data', 'Forfait', 'Hors forfait', 'forfait'].forEach((word) => {
    assert.equal(text.includes(word), false, word);
  });
});

test('rule 1: an unmanaged space lists everything exactly as before', () => {
  const s = space({ installed: ['linen'], managed: false });
  let out;
  s.controller.list({}, { json: (b) => { out = b; } });
  assert.equal(out.length, 16);
  assert.deepEqual(Object.keys(out.find((p) => p.id === 'linen')).includes('planChip'), true);
  assert.equal(out.find((p) => p.id === 'linen').state, 'active');
  assert.equal(out.find((p) => p.id === 'neat').state, 'available');
});

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function authFor(managed, roles = ['admin']) {
  const row = { id: 1, email: 'a@x.fr', roles };
  const users = { verifyCredentials: () => ({ ...row }), findById: () => ({ ...row }), touchLastLogin: () => {} };
  const ctrl = authController.create(users, { activePlugins: () => [], pluginsManageable: () => !managed });
  return { ctrl, row };
}

test('rule 3: /auth/me and login say pluginsManageable false to an administrator of a managed space', () => {
  const { ctrl, row } = authFor(true);
  const me = fakeRes();
  ctrl.me({ session: { user: row } }, me);
  assert.equal(me.body.pluginsManageable, false);
  const login = fakeRes();
  ctrl.login({ body: { email: row.email, password: 'x' }, session: {} }, login);
  assert.equal(login.body.pluginsManageable, false);
});

test('rule 3: an administrator of an unmanaged space — and only an administrator — manages the plugins', () => {
  const admin = authFor(false);
  const me = fakeRes();
  admin.ctrl.me({ session: { user: admin.row } }, me);
  assert.equal(me.body.pluginsManageable, true);
  const reception = authFor(false, ['reception']);
  const other = fakeRes();
  reception.ctrl.me({ session: { user: reception.row } }, other);
  assert.equal(other.body.pluginsManageable, false);
});

function onboarding({ managed }) {
  const { freshDb } = require('./guestEmailSequenceFixtures');
  const { applyProductisationSchema } = require('../utils/productisationMigration');
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  const calls = [];
  const plugins = {
    list: (req, res) => res.json([{ id: 'sas', name: 'SAS', description: '', state: 'available', outOfPlan: false, planChip: null }]),
    install: (req, res) => { calls.push(req.params.id); return res.json({ id: req.params.id }); },
    activate: (req, res) => res.json({}),
  };
  const controller = buildOnboarding({
    database: db,
    settingsModel: { read: () => ({}), upsert: () => {} },
    propertiesModel: { count: () => 0, create: async () => ({ id: 1 }) },
    plugins,
    ensureVapid: () => {},
    pluginStep: () => !managed,
  });
  return { controller, calls, db };
}

test('rule 8: on a managed space the assistant has no plugin step — no questions, no plugin summary', async () => {
  const { controller, db } = onboarding({ managed: true });
  const res = fakeRes();
  await controller.get({ user: { email: 'a@x.fr' } }, res);
  assert.equal(res.body.pluginStep, false);
  ['plugins', 'questions', 'pluginsSummary'].forEach((key) => assert.equal(key in res.body, false, key));
  assert.ok(res.body.company && res.body.emails && res.body.property);
  db.close();
});

test('rule 8: PUT /onboarding/plugins answers the unknown-route 404 and installs nothing', async () => {
  const { controller, calls, db } = onboarding({ managed: true });
  const res = fakeRes();
  await controller.savePlugins({ body: { answers: { options: true } } }, res);
  assert.deepEqual([res.statusCode, res.body], [404, UNKNOWN]);
  assert.deepEqual(calls, []);
  db.close();
});

test('rule 8: an unmanaged space keeps its plugin step and its questions', async () => {
  const { controller, calls, db } = onboarding({ managed: false });
  const res = fakeRes();
  await controller.get({ user: { email: 'a@x.fr' } }, res);
  assert.equal(res.body.pluginStep, true);
  assert.equal(res.body.questions.length, 3);
  const put = fakeRes();
  await controller.savePlugins({ body: { answers: { options: true } } }, put);
  assert.equal(put.statusCode, 200);
  assert.ok(calls.includes('sas'));
  db.close();
});
