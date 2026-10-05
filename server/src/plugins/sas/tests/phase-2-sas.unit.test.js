// specs/plugins-phase-2-hosts.md §3.C — the SAS is a plugin: its routes and the « Facturables » prices
// answer only while it is live (gap 3), its payload and commit leave the linen steps to `linen`
// (gap 5), the arrival/departure push opens it only while it is live (gap 6), and it has nothing to
// erase (rule 14). The commit itself stays in the core and keeps its own suites.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');
const express = require('express');

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const sasModule = require('..');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { ensurePluginsTable } = require('../../../utils/pluginsSchema');
const { createController } = require('../../../controllers/pluginsController');
const { runArrivalDeparturePush } = require('../../../utils/arrivalDeparturePushRunner');

const SRC = path.join(__dirname, '..', '..', '..');
const live = new Set();

function useLive(...ids) {
  live.clear();
  ids.forEach((id) => live.add(id));
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The core modules the controllers bind when they load, replaced for the duration of the load.
function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function freshRequire(rel, mocks) {
  const file = require.resolve(rel);
  delete require.cache[file];
  const mod = withMocks(mocks, () => require(rel));
  delete require.cache[file];
  return mod;
}

const LINEN_ITEMS = [
  { id: 1, label: 'Taie d’oreiller', price: 5, category: 'bed' },
  { id: 2, label: 'Drap housse', price: 12, category: 'bed' },
  { id: 3, label: 'Serviette', price: 8, category: 'towel' },
];

function bootRoutes() {
  registry.reset();
  registry.configure({ isActive: (id) => live.has(id), allows: () => true });
  loader.registerAll({ db: null, modules: [sasModule], isInstalled: () => false });
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return app;
}

async function request(app, method, url, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

// ---------- rule 8, gap 3 ----------

test('specs/plugins-phase-2-hosts.md rule 8 — the SAS and « Facturables » routes answer 404 PLUGIN_INACTIVE while sas is off (gap 3)', async () => {
  useLive('linen');
  const app = bootRoutes();
  for (const [method, url] of [
    ['GET', '/api/reservations/1/sas'],
    ['POST', '/api/reservations/1/sas/arrival'],
    ['POST', '/api/reservations/1/sas/departure'],
    ['GET', '/api/settings/linen-items'],
    ['PUT', '/api/settings/linen-items'],
    ['GET', '/api/settings/repair-amounts'],
    ['PUT', '/api/settings/repair-amounts'],
  ]) {
    const res = await request(app, method, url, method === 'GET' ? undefined : []);
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'sas' }, `${method} ${url}`);
  }
});

test('specs/plugins-phase-2-hosts.md rule 8 — while sas is live, the « Facturables » prices are read and replaced through the core models', async () => {
  useLive('sas');
  const linenFile = require.resolve('../../../models/linenItemsModel');
  const repairFile = require.resolve('../../../models/repairAmountsModel');
  const billablesFile = require.resolve('../billablesController');
  const saved = { linen: require.cache[linenFile], repair: require.cache[repairFile] };
  const written = [];
  require.cache[linenFile] = { id: linenFile, filename: linenFile, loaded: true, exports: { list: () => LINEN_ITEMS, replaceAll: (items) => { written.push(items); return items; } } };
  require.cache[repairFile] = { id: repairFile, filename: repairFile, loaded: true, exports: { list: () => [{ repairKey: 'extinguisher_seal', label: 'Plomb', price: 25 }], replaceAll: (items) => items } };
  delete require.cache[billablesFile];
  try {
    const app = bootRoutes();
    assert.deepEqual((await request(app, 'GET', '/api/settings/linen-items')).body, LINEN_ITEMS);
    assert.equal((await request(app, 'GET', '/api/settings/repair-amounts')).body[0].repairKey, 'extinguisher_seal');
    const put = await request(app, 'PUT', '/api/settings/linen-items', [{ label: 'Drap', price: 10, category: 'bed' }]);
    assert.equal(put.status, 200);
    assert.deepEqual(written, [[{ label: 'Drap', price: 10, category: 'bed' }]]);
    assert.equal((await request(app, 'PUT', '/api/settings/repair-amounts', { nope: 1 })).status, 400);
  } finally {
    delete require.cache[billablesFile];
    if (saved.linen) require.cache[linenFile] = saved.linen; else delete require.cache[linenFile];
    if (saved.repair) require.cache[repairFile] = saved.repair; else delete require.cache[repairFile];
  }
});

test('specs/plugins-phase-2-hosts.md rule 8 — the core declares no SAS route any more; the reception entries are the plugin’s', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  assert.doesNotMatch(read('routes/reservations.js'), /sasController|'\/:id\/sas/);
  assert.doesNotMatch(read('routes/settings.js'), /linen-items|repair-amounts/);
  assert.doesNotMatch(read('controllers/settingsController.js'), /linenItemsModel|repairAmountsModel/);
  assert.doesNotMatch(read('middleware/enforceRoleAccess.js'), /\\\/sas/);
  assert.equal(fs.existsSync(path.join(SRC, 'controllers/sasController.js')), false);
  assert.equal(fs.existsSync(path.join(SRC, 'utils/sasAudit.js')), false);

  useLive();
  bootRoutes();
  const entries = loader.roleMatchers('reception').filter((m) => m.pluginId === 'sas');
  assert.deepEqual(entries.map((m) => m.method), ['GET', 'POST', 'POST']);
  assert.ok(entries[0].re.test('/reservations/42/sas'));
  assert.ok(entries[1].re.test('/reservations/42/sas/arrival'));
  assert.ok(entries[2].re.test('/reservations/42/sas/departure'));
});

// ---------- rule 11, gap 5 ----------

const RESERVATION = {
  id: 1, propertyId: 7, startDate: '2026-07-19', endDate: '2026-07-26', options: [], resources: [], nights: [],
  bedLinenAlert: { type: 'capacity', capacity: 2, required: 4 },
};

function buildController({ captures = [], storedLines = [] } = {}) {
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => RESERVATION;
    if (k === 'getRow') return () => ({ ...RESERVATION, endOfStayComplementDetail: '[]' });
    if (k === 'getSasUpsellOptions') return () => ({
      cleaning: { present: false, sasOrigin: false },
      bathLinen: { present: false, sasOrigin: false, totalPrice: 0 },
    });
    if (k === 'isCleaningSoldForReservation') return () => false;
    if (k === 'getCleaningPriceForProperty') return () => 80;
    if (k === 'getBathLinenOfferForReservation') return () => ({ available: true, label: 'Linge de toilette', amount: 24 });
    if (k === 'buildArrivalComplementDetail') return () => ({ amount: 0, paid: 0, detail: [] });
    if (k === 'listSasArrivalCustomLines') return () => storedLines;
    if (k === 'commitArrivalSas') return (id, args) => { captures.push(args); return 0; };
    if (k === 'listSasArrivalOptionLines') return () => [];
    return () => null;
  } });
  return freshRequire('../controller', {
    '../../models/reservationsModel': reservationsModelMock,
    '../../models/linenItemsModel': { list: () => LINEN_ITEMS },
    '../../models/settingsModel': { read: () => ({ portalCode: '' }) },
    '../../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../../models/repairAmountsModel': { list: () => [] },
    '../../models/resourceSchedulingModel': { getSchedulingPayload: () => ({ applicable: false, resources: [] }) },
    './sasAudit': { buildSasSnapshot: () => ({}), computeSasChanges: () => [] },
  });
}

function readSas(mode) {
  registry.configure({ isActive: (id) => live.has(id), allows: () => true });
  const res = fakeRes();
  buildController().getSas({ params: { id: 1 }, query: mode ? { mode } : {}, user: { roles: ['admin'] } }, res);
  return res.body;
}

test('specs/plugins-phase-2-hosts.md rule 11 — without linen, the arrival payload carries no linen items, no towel offer and no bed-linen alert (gap 5)', () => {
  useLive('sas');
  const body = readSas('arrival');
  assert.equal('linenItems' in body, false);
  assert.equal('bathLinen' in body, false);
  assert.equal('bedLinenAlert' in body.reservation, false);
  assert.equal(RESERVATION.bedLinenAlert.type, 'capacity', 'the core reservation is left untouched');
});

test('specs/plugins-phase-2-hosts.md rule 11 — the departure « Objets manquants » step keeps its priced items without linen', () => {
  useLive('sas');
  const body = readSas('departure');
  assert.deepEqual(body.linenItems, LINEN_ITEMS);
  assert.equal('bathLinen' in body, false);
  assert.equal('bedLinenAlert' in body.reservation, false);
});

test('specs/plugins-phase-2-hosts.md rule 11 — with linen live, the payload is the full SAS payload', () => {
  useLive('sas', 'linen');
  const body = readSas('arrival');
  assert.deepEqual(body.linenItems, LINEN_ITEMS);
  assert.equal(body.bathLinen.available, true);
  assert.deepEqual(body.reservation.bedLinenAlert, RESERVATION.bedLinenAlert);
});

const ARRIVAL_BODY = {
  complementItems: [
    { label: 'Taie d’oreiller', amount: 10, offered: false },
    { label: 'Supplément soirée', amount: 15, offered: false },
  ],
  bathLinenAdded: true,
  bathLinenOffered: true,
  cleaningAdded: true,
};

function commitArrival({ storedLines = [], body = ARRIVAL_BODY } = {}) {
  registry.configure({ isActive: (id) => live.has(id), allows: () => true });
  const captures = [];
  const res = fakeRes();
  buildController({ captures, storedLines })
    .commitArrival({ params: { id: '1' }, body: JSON.parse(JSON.stringify(body)), user: { roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 200);
  return captures[0];
}

test('specs/plugins-phase-2-hosts.md rule 11 — without linen, the arrival commit ignores the towel upsell and the bed-linen lines (gap 5)', () => {
  useLive('sas');
  const args = commitArrival({ storedLines: [
    { description: 'Drap housse', amount: 12, offered: 1 },
    { description: 'Supplément soirée', amount: 15, offered: 0 },
  ] });
  assert.equal(args.bathLinenAdded, undefined, 'the towel upsell is left as it is');
  assert.equal(args.bathLinenOffered, false);
  assert.equal(args.cleaningAdded, true, 'the other SAS decisions go through');
  // The bed line sent is dropped; the one a previous check-in stored is kept as it was, so the
  // replace-all commit neither adds nor removes linen money.
  assert.deepEqual(args.complementItems, [
    { label: 'Supplément soirée', amount: 15, offered: false },
    { label: 'Drap housse', amount: 12, offered: true },
  ]);
});

test('specs/plugins-phase-2-hosts.md rule 11 — without linen, « Offrir » on a stored bed-linen line is kept, at the stored amount', () => {
  useLive('sas');
  const args = commitArrival({
    storedLines: [{ description: 'Drap housse', amount: 15, offered: 0 }],
    body: { ...ARRIVAL_BODY, complementItems: [{ label: 'Drap housse', amount: 999, offered: true }] },
  });
  assert.deepEqual(args.complementItems, [{ label: 'Drap housse', amount: 15, offered: true }]);
});

test('specs/plugins-phase-2-hosts.md rule 11 — with linen live, the arrival commit receives the linen decisions as sent', () => {
  useLive('sas', 'linen');
  const args = commitArrival();
  assert.equal(args.bathLinenAdded, true);
  assert.equal(args.bathLinenOffered, true);
  assert.deepEqual(args.complementItems, ARRIVAL_BODY.complementItems);
});

// ---------- rule 12, gap 6 ----------

test('specs/plugins-phase-2-hosts.md rule 12 — the arrival/departure push opens the SAS only while sas is live (gap 6)', async () => {
  const reservationsModel = {
    dueArrivals: () => [{ id: 7, checkInTime: '15:00', firstName: 'Jean', lastName: 'Dupont' }],
    dueDepartures: () => [{ id: 8, checkOutTime: '10:00', firstName: 'Anne', lastName: 'Martin' }],
    stampArrivalNotified: () => {},
    stampDepartureNotified: () => {},
  };
  const urls = async (isSasLive) => {
    const sent = [];
    await runArrivalDeparturePush({
      reservationsModel, pushService: { sendToPref: async (pref, payload) => { sent.push(payload.url); } }, isSasLive,
    });
    return sent;
  };
  assert.deepEqual(await urls(() => true), ['/planning?sas=arrival&reservationId=7', '/planning?sas=departure&reservationId=8']);
  assert.deepEqual(await urls(() => false), ['/reservations/7', '/reservations/8']);

  useLive();
  registry.configure({ isActive: (id) => live.has(id), allows: () => true });
  assert.deepEqual(await urls(undefined), ['/reservations/7', '/reservations/8'], 'by default it asks the registry');
});

// ---------- rule 14 ----------

test('specs/plugins-phase-2-hosts.md rule 14 — sas has a module but nothing to erase', async () => {
  useLive('sas');
  bootRoutes();
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  const plugins = buildPluginsModel(db);
  plugins.install('sas');
  const controller = createController(plugins, { registry, db: () => db });

  const res = fakeRes();
  controller.list({}, res);
  const sas = res.body.find((p) => p.id === 'sas');
  assert.equal(sas.hasModule, true);
  assert.equal(sas.erasable, false);
  assert.deepEqual(sas.data, []);

  const refused = fakeRes();
  await controller.uninstall({ params: { id: 'sas' }, query: { purge: '1' } }, refused);
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(refused.body, { error: 'NOT_ERASABLE' });
  assert.ok(plugins.get('sas'), 'nothing was uninstalled');
});

// ---------- rule 13 ----------

test('specs/plugins-phase-2-hosts.md rule 13 — « Accueil » stays a core role, and a reception-only account still keeps the module on', async () => {
  assert.equal(require('../../../constants/roles').RECEPTION, 'reception');
  const sources = fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /RECEPTION\s*=/, 'the plugin declares no role of its own');

  useLive('sas');
  bootRoutes();
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  const plugins = buildPluginsModel(db);
  plugins.install('sas');
  const userId = db.prepare("INSERT INTO users (email, passwordHash, isActive) VALUES ('accueil@example.test', 'x', 1)").run().lastInsertRowid;
  db.prepare("INSERT INTO user_roles (userId, role) VALUES (?, 'reception')").run(userId);

  const res = fakeRes();
  await createController(plugins, { registry, db: () => db }).deactivate({ params: { id: 'sas' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RECEPTION_USERS');
  assert.equal(plugins.isActive('sas'), true);
});
