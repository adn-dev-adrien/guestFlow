// specs/control-plane-plans-and-access.md — C1, the entitlement inside the instance: the signed
// licence (rules 9, 10, 29, 30), plugins outside the plan (rules 11, 12), quotas (rule 13), the
// read-only path (rules 14, 16), the banner payload (§4.3) and the host-only session cookie (rule 23).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const { createLicenceReader, signLicence, FILE_NAME } = require('../utils/licence');
const { enforceSubscription, closedWhenReadOnly, isAllowedWrite } = require('../middleware/enforceSubscription');
const { quotaRefusal } = require('../utils/planQuota');
const { ensurePluginsTable } = require('../utils/pluginsSchema');
const pluginsModel = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');
const registry = require('../plugins/sdk/registry');
const { buildController: buildUsersController } = require('../controllers/usersController');
const { buildSessionCookieOptions } = require('../utils/securityConfig');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_B64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const NOW = new Date('2026-11-01T10:00:00Z');

const PRO = {
  slug: 'solio',
  plan: 'pro',
  planName: 'Pro',
  catalogueVersion: 1,
  plugins: ['school-holidays', 'weather-alerts', 'google-calendar', 'sas', 'website-booking', 'online-payment', 'linen', 'accounting-export'],
  planOf: { 'tariff-recipes': 'Premium', 'hourly-resources': 'Premium', neat: 'Premium', 'gate-access': 'Premium' },
  quotas: { units: 6, users: 5 },
  state: 'active',
  stateSince: '2026-01-01',
  endsAt: '2026-12-31',
  payUrl: null,
  issuedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-30T00:00:00Z',
};

function reader({ payload = PRO, token, managed = true, key = PUBLIC_B64, now = () => NOW, files } = {}) {
  const store = files || { [`/data/${FILE_NAME}`]: token !== undefined ? token : payload && signLicence(payload, privateKey) };
  const logs = [];
  const r = createLicenceReader({
    dataDir: '/data',
    publicKey: key,
    managed,
    now,
    readFile: (file) => {
      if (store[file] == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return store[file];
    },
    log: (msg) => logs.push(msg),
  });
  return Object.assign(r, { logs, store });
}

// ---------- the licence (rules 9, 10, 29, 30) ----------

test('rule 9: a licence signed by the control plane is read with its plan, plugins and quotas', () => {
  const r = reader();
  assert.equal(r.current().valid, true);
  assert.equal(r.effectiveState(), 'active');
  assert.equal(r.isReadOnly(), false);
  assert.equal(r.allowsPlugin('sas'), true);
  assert.equal(r.allowsPlugin('neat'), false);
  assert.equal(r.planFor('neat'), 'Premium');
  assert.equal(r.quota('units'), 6);
  assert.equal(r.planName(), 'Pro');
});

test('rule 10: a tampered payload is refused and the instance falls back to read-only', () => {
  const token = signLicence(PRO, privateKey).split('.');
  token[1] = Buffer.from(JSON.stringify({ ...PRO, plugins: [...PRO.plugins, 'neat'] })).toString('base64url');
  const r = reader({ token: token.join('.') });
  assert.equal(r.current().valid, false);
  assert.equal(r.current().reason, 'bad signature');
  assert.equal(r.effectiveState(), 'read_only');
  assert.equal(r.isReadOnly(), true);
  assert.match(r.logs[0], /^\[licence\] bad signature/);
});

test('rule 10: a licence signed with another key is refused', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const r = reader({ token: signLicence(PRO, other) });
  assert.equal(r.isReadOnly(), true);
});

test('rule 10: an expired licence means read-only, never suspended', () => {
  const r = reader({ payload: { ...PRO, expiresAt: '2026-11-01T09:59:59Z' } });
  assert.equal(r.current().reason, 'expired');
  assert.equal(r.effectiveState(), 'read_only');
});

test('rule 10: a managed instance with no licence file is read-only', () => {
  const r = reader({ files: {} });
  assert.equal(r.current().reason, 'missing');
  assert.equal(r.isReadOnly(), true);
});

test('rule 29: an unmanaged instance with no licence file enforces nothing', () => {
  const r = reader({ files: {}, managed: false });
  assert.equal(r.current().enforced, false);
  assert.equal(r.isReadOnly(), false);
  assert.equal(r.allowsPlugin('neat'), true);
  assert.equal(r.quota('units'), null);
  assert.deepEqual(r.banner(), { state: null, text: null });
  assert.equal(r.logs.length, 0);
});

test('rule 29: a licence file present on an unmanaged instance is still enforced', () => {
  const r = reader({ managed: false });
  assert.equal(r.current().enforced, true);
  assert.equal(r.allowsPlugin('neat'), false);
});

test('rule 30: without a verification key the licence cannot be trusted → read-only', () => {
  const r = reader({ key: null });
  assert.equal(r.current().reason, 'no verification key');
  assert.equal(r.isReadOnly(), true);
});

test('rule 9: the licence is re-read at most once a minute', () => {
  let t = NOW.getTime();
  const r = reader({ now: () => new Date(t) });
  assert.equal(r.effectiveState(), 'active');
  r.store[`/data/${FILE_NAME}`] = signLicence({ ...PRO, state: 'read_only' }, privateKey);
  t += 59 * 1000;
  assert.equal(r.effectiveState(), 'active');
  t += 2 * 1000;
  assert.equal(r.effectiveState(), 'read_only');
});

test('rule 14: read_only, suspended and archived all stop writes; trial, due and grace do not', () => {
  for (const [state, readOnly] of [['trial', false], ['active', false], ['due', false], ['grace', false], ['read_only', true], ['suspended', true], ['archived', true]]) {
    assert.equal(reader({ payload: { ...PRO, state } }).isReadOnly(), readOnly, state);
  }
});

test('rule 9: an expiry date that cannot be read is no bound — the licence is refused', () => {
  for (const expiresAt of [1700000000, '31/12/2020', 'demain']) {
    const r = reader({ payload: { ...PRO, expiresAt } });
    assert.equal(r.current().valid, false, String(expiresAt));
    assert.equal(r.isReadOnly(), true);
  }
});

test('rule 9: a licence issued for another instance is refused when the instance knows its slug', () => {
  const store = { [`/data/${FILE_NAME}`]: signLicence({ ...PRO, slug: 'aulnes' }, privateKey) };
  const r = createLicenceReader({ dataDir: '/data', publicKey: PUBLIC_B64, managed: true, slug: 'solio', now: () => NOW, readFile: (f) => store[f], log: () => {} });
  assert.equal(r.current().valid, false);
  assert.match(r.current().reason, /another instance \(aulnes\)/);
  assert.equal(reader().current().valid, true, 'no slug configured: not checked');
});

test('rule 29: a licence file that is there but unreadable is enforced, and logged', () => {
  const r = createLicenceReader({
    dataDir: '/data', publicKey: PUBLIC_B64, managed: false, now: () => NOW, log: (m) => r.logs.push(m),
    readFile: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
  });
  r.logs = [];
  assert.equal(r.current().enforced, true);
  assert.equal(r.isReadOnly(), true);
  assert.match(r.logs[0], /unreadable \(EACCES\)/);
});

test('rule 12: once expired, the licence still decides the plugins — a withdrawn one never comes back', () => {
  const r = reader({ payload: { ...PRO, expiresAt: '2026-10-01T00:00:00Z' } });
  assert.equal(r.isReadOnly(), true);
  assert.equal(r.allowsPlugin('linen'), true);
  assert.equal(r.allowsPlugin('neat'), false);
  assert.equal(r.planFor('neat'), 'Premium');
  assert.equal(reader({ token: 'not.a.licence' }).allowsPlugin('neat'), true, 'unreadable: the stored states stay');
});

test('rule 9: a licence that does not verify is read again within seconds, not a minute', () => {
  let t = NOW.getTime();
  const r = reader({ token: 'half.written', now: () => new Date(t) });
  assert.equal(r.current().valid, false);
  r.store[`/data/${FILE_NAME}`] = signLicence(PRO, privateKey);
  t += 3000;
  assert.equal(r.current().valid, true);
});

test('an unknown state is refused rather than guessed', () => {
  assert.equal(reader({ payload: { ...PRO, state: 'paused' } }).current().reason, 'unknown state');
});

// ---------- the banner payload (§4.3) ----------

test('the banner counts the days left in Paris days', () => {
  // 23:30 UTC on 11/11 is already 12/11 in Paris: the subscription ends today.
  const r = reader({ payload: { ...PRO, state: 'due', endsAt: '2026-11-12' }, now: () => new Date('2026-11-11T23:30:00Z') });
  assert.deepEqual(r.banner(), { state: 'due', endsAt: '2026-11-12', daysLeft: 0, planName: 'Pro', payUrl: null, severity: 'info', text: 'Abonnement Pro jusqu’au 12/11/2026.' });
  const later = reader({ payload: { ...PRO, state: 'grace', endsAt: '2026-11-12', payUrl: 'https://pay.qonto.com/x' }, now: () => new Date('2026-11-15T09:00:00Z') });
  assert.equal(later.banner().daysLeft, -3);
  assert.equal(later.banner().payUrl, 'https://pay.qonto.com/x');
  assert.equal(later.banner().text, 'Abonnement échu depuis le 12/11/2026 : à renouveler pour garder l’accès complet.');
});

test('the banner reads a date-time as its Paris day, and words the trial without guessing', () => {
  const at = (endsAt, now) => reader({ payload: { ...PRO, state: 'trial', endsAt }, now: () => new Date(now) }).banner();
  const late = at('2026-11-11T23:00:00Z', '2026-11-01T10:00:00Z');
  assert.equal(late.endsAt, '2026-11-12', '23:00 UTC is already the 12th in Paris');
  assert.equal(late.text, 'Période d’essai : 11 jours restants.');
  assert.equal(at('2026-11-01', '2026-11-01T10:00:00Z').text, 'Dernier jour de la période d’essai.');
  assert.equal(reader({ payload: { ...PRO, state: 'trial', endsAt: null } }).banner().text, 'Période d’essai.');
});

test('an untrusted licence shows the read-only banner without dates', () => {
  assert.deepEqual(reader({ files: {} }).banner(), {
    state: 'read_only', endsAt: null, daysLeft: null, planName: null, payUrl: null,
    severity: 'error', text: 'Lecture seule : données consultables et exportables, calendriers toujours synchronisés.',
  });
});

// ---------- plugins outside the plan (rules 11, 12) ----------

function pluginsSetup(licence) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  const model = pluginsModel.buildModel(db);
  const ctrl = createController(model, { licence: () => licence, registry: { get: () => null } });
  const call = async (handler, id) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await ctrl[handler]({ params: { id }, query: {} }, res);
    return res;
  };
  return { model, ctrl, call };
}

test('rule 11: installing a plugin outside the plan answers 402 PLAN_REQUIRED with the plan to buy', async () => {
  const { model, call } = pluginsSetup(reader());
  const res = await call('install', 'neat');
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'PLAN_REQUIRED');
  assert.equal(res.body.plan, 'Premium');
  assert.equal(res.body.message, 'Inclus dans le forfait Premium, sur demande.');
  assert.equal(model.get('neat'), null);
});

test('rule 11: the list marks a plugin outside the plan with its plan chip', async () => {
  const { call } = pluginsSetup(reader());
  const list = (await call('list')).body;
  const neat = list.find((p) => p.id === 'neat');
  assert.equal(neat.outOfPlan, true);
  assert.equal(neat.planChip, 'Forfait Premium');
  assert.equal(neat.planHint, 'Inclus dans le forfait Premium, sur demande.');
  const sas = list.find((p) => p.id === 'sas');
  assert.deepEqual([sas.outOfPlan, sas.planChip], [false, null]);
});

test('rule 4: a plugin in no plan reads « Option à la carte »', async () => {
  const { call } = pluginsSetup(reader({ payload: { ...PRO, planOf: {} } }));
  const neat = (await call('list')).body.find((p) => p.id === 'neat');
  assert.equal(neat.planChip, 'Option à la carte');
  assert.match((await call('install', 'neat')).body.message, /option/);
});

test('rule 12: a downgrade leaves the stored state untouched and an upgrade brings the plugin back as it was', async () => {
  const premium = reader({ payload: { ...PRO, plugins: [...PRO.plugins, 'neat'] } });
  const { model, call } = pluginsSetup(premium);
  assert.equal((await call('install', 'neat')).statusCode, 200);

  const afterDowngrade = pluginsSetup(reader());
  afterDowngrade.model.install('neat');
  const neat = (await afterDowngrade.call('list')).body.find((p) => p.id === 'neat');
  assert.deepEqual([neat.state, neat.outOfPlan], ['active', true]);
  assert.equal((await afterDowngrade.call('activate', 'neat')).statusCode, 402);
  assert.equal(afterDowngrade.model.get('neat').enabled, true);

  assert.equal(model.get('neat').enabled, true);
  const back = (await call('list')).body.find((p) => p.id === 'neat');
  assert.deepEqual([back.state, back.outOfPlan], ['active', false]);
});

test('rule 12: a plugin outside the licence is not live, wherever the core asks', () => {
  try {
    registry.configure({ isActive: () => true, allows: (id) => id !== 'neat' });
    assert.equal(registry.isLive('neat'), false);
    assert.equal(registry.isLive('sas'), true);
  } finally {
    registry.reset();
  }
});

// ---------- quotas (rule 13) ----------

test('rule 13: one unit beyond the plan is refused with the plan named', () => {
  const r = reader();
  assert.equal(quotaRefusal('units', () => 5, r), null);
  assert.deepEqual(quotaRefusal('units', () => 6, r), {
    error: 'QUOTA_REACHED',
    quota: 'units',
    limit: 6,
    message: 'Forfait Pro : 6 logements maximum.',
  });
});

test('rule 13: an unlimited quota never counts', () => {
  const r = reader({ payload: { ...PRO, quotas: { units: 15, users: null } } });
  assert.equal(quotaRefusal('users', () => { throw new Error('must not count'); }, r), null);
});

test('rule 13: an account beyond the quota is refused before any welcome email is sent', async () => {
  const sent = [];
  const ctrl = buildUsersController({
    usersModel: { countActive: () => 5, createUser: () => { throw new Error('must not create'); } },
    settingsModel: { smtpConfigured: () => false },
    emailService: { isConfigured: true, send: async (m) => { sent.push(m); } },
    planQuota: (quota, count) => quotaRefusal(quota, count, reader()),
  });
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await ctrl.create({ body: { firstName: 'A', lastName: 'B', email: 'a@b.fr', roles: ['admin'] }, user: { id: 1, roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.message, 'Forfait Pro : 5 comptes maximum.');
  assert.equal(sent.length, 0);
});

test('rule 13: below the quota the account creation carries on', async () => {
  const ctrl = buildUsersController({
    usersModel: { countActive: () => 4 },
    settingsModel: { smtpConfigured: () => false },
    planQuota: (quota, count) => quotaRefusal(quota, count, reader()),
  });
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await ctrl.create({ body: { firstName: 'A', lastName: 'B', email: 'a@b.fr', roles: ['admin'] }, user: { id: 1, roles: ['admin'] } }, res);
  assert.equal(res.body.error, 'SMTP_NOT_CONFIGURED');
});

// ---------- read-only (rules 14, 16) ----------

async function withApp(readOnly, run) {
  const app = express();
  app.use(express.json());
  // A plugin webhook passes like a sync (specs/plugins-phase-3a-online-payment.md rule 12): the Qonto
  // one, as the loader reports it once online-payment registered.
  app.use('/api', enforceSubscription({ isReadOnly: () => readOnly, isWebhook: (m, p) => m === 'POST' && p === '/payments/qonto/webhook' }));
  app.use('/public/v1/booking-requests', closedWhenReadOnly({ isReadOnly: () => readOnly }));
  app.all(/.*/, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('rule 14: in read-only a write answers 402 with the French message, a read still works', async () => {
  await withApp(true, async (base) => {
    let res = await fetch(`${base}/api/clients/3`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), {
      error: 'SUBSCRIPTION_READ_ONLY',
      message: 'Modification impossible : abonnement à renouveler.',
    });
    res = await fetch(`${base}/api/clients/3`);
    assert.equal(res.status, 200);
  });
});

test('rule 16: in read-only the calendar sync and collecting a payment keep working', async () => {
  await withApp(true, async (base) => {
    for (const [method, path] of [
      ['POST', '/api/properties/4/ical-sources/9/sync'],
      ['POST', '/api/properties/4/ical-sources/sync-all'],
      ['POST', '/api/google-calendar/sync-now'],
      ['POST', '/api/payments/qonto/webhook'],
      ['POST', '/api/payments/reservations/12/payment-links'],
      ['PATCH', '/api/reservations/12/payment'],
      ['POST', '/api/reservations/12/arrival-payment'],
    ]) {
      const res = await fetch(`${base}${path}`, { method });
      assert.equal(res.status, 200, `${method} ${path}`);
    }
  });
});

test('rule 14: in read-only, opening a reservation recomputes its price without a refusal', async () => {
  await withApp(true, async (base) => {
    for (const path of ['/api/reservations/calculate-price', '/api/properties/4/pricing/progressive-preview', '/api/terms/preview']) {
      assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 200, path);
    }
  });
  assert.equal(isAllowedWrite('POST', '/reservations/calculate-price/x'), false);
});

test('rule 13: resetting the password of a disabled account counts it against the quota', async () => {
  const ctrl = buildUsersController({
    usersModel: { countActive: () => 5, findById: () => ({ id: 7, isActive: 0, roles: ['admin'] }), resetUserPassword: () => { throw new Error('must not reset'); } },
    settingsModel: { smtpConfigured: () => true },
    planQuota: (quota, count) => quotaRefusal(quota, count, reader()),
  });
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await ctrl.resetPassword({ params: { id: '7' }, user: { id: 1, roles: ['admin'] }, session: { user: { id: 1 } } }, res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'QUOTA_REACHED');
});

test('rule 14: the allow-list is exact — a neighbouring write is still refused', () => {
  assert.equal(isAllowedWrite('PUT', '/reservations/12/payment'), false);
  assert.equal(isAllowedWrite('POST', '/reservations/12/refunds'), false);
  assert.equal(isAllowedWrite('PUT', '/payments/qonto/credentials'), false);
  assert.equal(isAllowedWrite('POST', '/properties/4/ical-sources'), false);
});

test('rule 14: outside read-only nothing is refused', async () => {
  await withApp(false, async (base) => {
    assert.equal((await fetch(`${base}/api/clients/3`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/public/v1/booking-requests`, { method: 'POST' })).status, 200);
  });
});

test('rule 14: the website takes no new booking while read-only (503, French message)', async () => {
  await withApp(true, async (base) => {
    const res = await fetch(`${base}/public/v1/booking-requests`, { method: 'POST' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'BOOKING_UNAVAILABLE', message: 'Réservations en ligne momentanément indisponibles.' });
  });
});

// ---------- addresses (rule 23) ----------

test('rule 23: the session cookie is host-only — never shared across customer subdomains', () => {
  for (const httpsEnabled of [true, false]) {
    assert.equal('domain' in buildSessionCookieOptions({ httpsEnabled }), false);
  }
});
