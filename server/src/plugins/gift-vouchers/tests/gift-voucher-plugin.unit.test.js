// specs/gift-vouchers.md rules 1-4, 10, 32 — the plugin as the core sees it: its manifest and catalogue entry, what it registers,
// its settings, the pepper that is never drawn again, and an erasure refused while a voucher still has a balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const fx = require('./giftVoucherFixtures');
const registry = require('../../sdk/registry');
const loader = require('../../loader');
const gv = require('..');
const settings = require('../settings');
const { readSourceManifest } = require('../../manifest');
const { PLUGIN_IDS, findPlugin } = require('../../../constants/plugins');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function bootDb({ install = true } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (install) plugins.install('gift-vouchers');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [gv], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  return { db, plugins, settingsModel };
}

const fakeRes = () => ({
  statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
});

const withPepper = (value, fn) => {
  const saved = process.env[gv.PEPPER_NAME];
  if (value === undefined) delete process.env[gv.PEPPER_NAME]; else process.env[gv.PEPPER_NAME] = value;
  try { return fn(); } finally { if (saved === undefined) delete process.env[gv.PEPPER_NAME]; else process.env[gv.PEPPER_NAME] = saved; }
};

test('rule 1: the plugin is in the catalogue, its manifest is valid and names no requirement: the online sale reads the payment provider live (rule 2)', () => {
  assert.ok(PLUGIN_IDS.includes('gift-vouchers'));
  const manifest = readSourceManifest('gift-vouchers');
  assert.equal(findPlugin('gift-vouchers').name, 'Bons cadeaux');
  assert.deepEqual(manifest.requires, []);
  assert.equal(manifest.sdk, '^2.35.0');
  assert.ok(require('../..').some((m) => m.id === 'gift-vouchers'));
});

test('rule 3: nothing in the plugin names an establishment, a property or a platform', () => {
  const dir = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const text = walk(dir).filter((f) => /\.(js|json)$/.test(f) && !f.includes(`${path.sep}tests${path.sep}`)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  [/solio/i, /estiva/i, /granja/i, /booking\.com/i, /airbnb/i, /lodgify/i].forEach((word) => assert.equal(word.test(text), false, String(word)));
});

test('rules 1, 4, 12: it mounts one public tree and one admin tree, declares its settings, six jobs, its push channels, its payment basket, its prepaid source and the home item', () => {
  const calls = { mounts: [], settings: [], jobs: [], attention: [], channels: [], events: [], prepaid: [] };
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      switch (key) {
        case 'mount': return (at, router, options) => calls.mounts.push([at, Boolean(options && options.public)]);
        case 'settings': return { declare: (keys) => calls.settings.push(...keys.map((k) => k.key)), get: () => '' };
        case 'jobs': return { every: (job) => calls.jobs.push(job.name) };
        case 'attention': return (item) => calls.attention.push(item.key);
        case 'pushChannel': return (c) => calls.channels.push(c.key);
        case 'events': return { on: (name) => calls.events.push(name) };
        case 'prepaid': return (source) => calls.prepaid.push([source.source, source.label]);
        case 'db': return null;
        default: return noop;
      }
    },
  });
  withPepper(undefined, () => gv.register(ctx));
  assert.deepEqual(calls.mounts, [['/public/v1/gift-vouchers', true], ['/api/gift-vouchers', false]]);
  assert.deepEqual(calls.settings, ['pageUrl', 'linkBase']);
  assert.deepEqual(calls.jobs, ['pending-orders-purge', 'receipts-retry', 'holds-release', 'uses-lapse', 'visuals-purge', 'checks-purge']);
  assert.deepEqual(calls.prepaid, [['giftVoucher', 'Bon cadeau']]);
  assert.deepEqual(calls.attention, ['gift-voucher-checks']);
  assert.deepEqual(calls.channels, ['gift-voucher-checks', 'online-sales'], 'the second is the channel shared with the sessions booked online (specs/site-outside-resource-booking.md rule 22)');
  assert.deepEqual(calls.events, ['pricing.changed']);
});

test('rule 1: registering draws no secret — a plugin nobody installed leaves .env.local alone', () => {
  const envFile = path.join(__dirname, '..', '..', '..', '..', '.env.local');
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  withPepper(undefined, () => bootDb({ install: false }));
  assert.equal(process.env[gv.PEPPER_NAME], undefined);
  assert.equal(fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null, before);
});

test('rule 32: with vouchers in the database and the pepper gone, the plugin refuses to register instead of drawing a new pepper', () => {
  const { db } = withPepper('kept', () => bootDb());
  const fixture = fx.buildApi(db);
  fixture.api.orders.create({ amountCents: 5000, source: 'manual' });
  const order = db.prepare('SELECT id FROM gift_voucher_orders').get();
  fixture.api.issuance.issue({ orderId: order.id, actor: 'system' });
  const plugins = buildPluginsModel(db);
  const settingsModel = buildPluginSettingsModel(db);
  const boot = () => {
    registry.reset();
    registry.configure({ isActive: (id) => plugins.isActive(id) });
    loader.registerAll({ db, modules: [gv], settingsModel: () => settingsModel, isInstalled: () => true });
    return registry.get('gift-vouchers');
  };
  withPepper(undefined, () => {
    const record = boot();
    assert.ok(record.failed, 'reported failed');
    assert.match(String(record.failed.message || record.failed), /GIFT_VOUCHER_PEPPER/);
    assert.equal(process.env[gv.PEPPER_NAME], undefined, 'and nothing was drawn');
  });
  withPepper('kept', () => assert.ok(!boot().failed));
});

test('rule 32: assertPepperKept — only a missing pepper with vouchers present throws', () => {
  const run = (env, vouchers) => () => gv.assertPepperKept({ hasVouchers: () => vouchers, env });
  assert.throws(run({}, true), /GIFT_VOUCHER_PEPPER/);
  assert.throws(run({ GIFT_VOUCHER_PEPPER: '  ' }, true), /GIFT_VOUCHER_PEPPER/);
  assert.doesNotThrow(run({}, false));
  assert.doesNotThrow(run({ GIFT_VOUCHER_PEPPER: 'x' }, true));
  assert.equal(gv.tableHasRows(new Database(':memory:')), false, 'no table yet');
});

test('rule 4: erasing the data is refused while a voucher has a balance — 409, nothing dropped — and goes through once none has', async () => {
  const { db, plugins, settingsModel } = withPepper('kept', () => bootDb());
  const fixture = fx.buildApi(db);
  const server = await fx.start(fixture);
  let voucher;
  try {
    voucher = await fx.issueManual(server, { amountCents: 8000 });
    const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, loader: () => loader });
    const refused = fakeRes();
    controller.uninstall({ params: { id: 'gift-vouchers' }, query: { purge: '1' } }, refused);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.body.error, 'ERASE_REFUSED');
    assert.match(refused.body.message, /solde/);
    assert.ok(db.prepare('SELECT 1 FROM gift_vouchers').get(), 'rows kept');
    assert.ok(plugins.get('gift-vouchers'), 'still installed');
    assert.deepEqual(registry.get('gift-vouchers').data.describe(db), [{ label: '1 bon cadeau', count: 1 }]);
    await server.call('POST', `/api/gift-vouchers/${voucher.id}/cancel`, {});
    const done = fakeRes();
    controller.uninstall({ params: { id: 'gift-vouchers' }, query: { purge: '1' } }, done);
    assert.equal(done.statusCode, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'gift_voucher%'").get().n, 0);
  } finally {
    await server.close();
  }
});

test('rule 4: the purge itself refuses too, whatever called it', () => {
  const { db } = withPepper('kept', () => bootDb());
  const fixture = fx.buildApi(db);
  fixture.api.orders.create({ amountCents: 5000, source: 'manual' });
  fixture.api.issuance.issue({ orderId: 1, actor: 'system' });
  assert.throws(() => registry.get('gift-vouchers').data.purge(db), /solde/);
  assert.equal(typeof registry.get('gift-vouchers').data.refuse, 'function');
});

test('rule 9 of the campaigns spec: linkBase is one lowercase segment of the permanent paths, « bon-cadeau » by default', () => {
  const declared = settings.DECLARED.find((d) => d.key === 'linkBase');
  assert.equal(declared.default, 'bon-cadeau');
  ['bon-cadeau', 'cadeaux', 'offrir2', '', null].forEach((v) => assert.equal(declared.validate(v), null, String(v)));
  ['Bon Cadeau', '/bon-cadeau', 'a/b', '-x', 'x-', 'é', 'x'.repeat(41), 42, ['a']].forEach((v) => assert.notEqual(declared.validate(v), null, String(v)));
});

test('rule 22: the page addresses refuse a wrong shape — the bounds, validity, VAT rate and ideas are a campaign\'s now, judged in gift-voucher-campaign-rules', () => {
  const validate = (key) => settings.DECLARED.find((d) => d.key === key).validate;
  ['validityMonths', 'minAmountCents', 'maxAmountCents', 'vatRatePercent', 'ideas'].forEach((key) => assert.equal(settings.DECLARED.some((d) => d.key === key), false, key));
  assert.equal(validate('pageUrl')('https://site.test/bon'), null);
  assert.equal(validate('pageUrl')(''), null);
  ['http://site.test', 'javascript:alert(1)', 'not a url'].forEach((v) => assert.notEqual(validate('pageUrl')(v), null, v));
});
