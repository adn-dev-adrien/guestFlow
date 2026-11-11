// specs/plugins-phase-1-sdk.md rule 7, readings of 2026-11-04 and 2026-11-05 (audit R22-P1, R23-P1) — the generic settings
// write: an object or a list is 400 INVALID_SETTING with nothing written and no validator called; a field of spaces keeps a
// secret as '' does; a secret is a string or null, and a boolean never reaches a validator.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const loader = require('../plugins/loader');
const registry = require('../plugins/sdk/registry');
const { buildModel: buildPluginsModel } = require('../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../models/pluginSettingsModel');
const { createController } = require('../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../utils/pluginsSchema');

const ID = 'settings-shape-fixture';
const T = JSON.parse('{"toString":1}');
const validated = [];

const fixture = {
  id: ID,
  register(ctx) {
    ctx.settings.declare([
      { key: 'apiKey', secret: true },
      { key: 'label' },
      { key: 'checked', validate: (value) => { validated.push(value); return String(value) === 'bad' ? 'Non.' : null; } },
    ]);
  },
};

function boot() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  const plugins = buildPluginsModel(db);
  plugins.install(ID);
  registry.reset();
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [fixture], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const controller = createController(plugins, { registry, db: () => db, settingsModel: () => settingsModel, licence: () => ({ allowsPlugin: () => true, planFor: () => null }) });
  const save = (body) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    controller.saveSettings({ params: { id: ID }, body }, res);
    return res;
  };
  return { save, settingsModel };
}

test.afterEach(() => { registry.reset(); validated.length = 0; });

test('R22-P1 — an object or a list never reaches a secret or a validator, and writes nothing', () => {
  const { save, settingsModel } = boot();
  assert.equal(save({ apiKey: 'the-real-key', label: 'avant' }).statusCode, 200);
  for (const value of [{ a: 1 }, T, [], ['x'], [T]]) {
    for (const key of ['apiKey', 'label', 'checked']) {
      const res = save({ [key]: value });
      assert.equal(res.statusCode, 400, `${key} ${JSON.stringify(value)}`);
      assert.equal(res.body.error, 'INVALID_SETTING');
      assert.equal(res.body.errors[key], 'Valeur invalide.');
    }
  }
  assert.deepEqual(validated, []);
  assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), 'the-real-key');
  assert.equal(settingsModel.raw(ID, 'label'), 'avant');
});

test('R22-P1 — a write is whole: one wrong field and nothing of the request is stored', () => {
  const { save, settingsModel } = boot();
  const res = save({ label: 'nouveau', checked: T });
  assert.equal(res.statusCode, 400);
  assert.equal(settingsModel.raw(ID, 'label'), '');
});

test('R22-P1 — spaces on a secret keep it, as an empty draft does; null clears it', () => {
  const { save, settingsModel } = boot();
  save({ apiKey: 'the-real-key' });
  for (const draft of ['', '   ', '\t ']) {
    assert.equal(save({ apiKey: draft }).statusCode, 200);
    assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), 'the-real-key', JSON.stringify(draft));
  }
  assert.equal(save({ apiKey: null }).statusCode, 200);
  assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), '');
});

test('R22-P1 — strings, numbers and booleans stay accepted; a plain setting can still be emptied', () => {
  const { save, settingsModel } = boot();
  assert.equal(save({ label: 'x', checked: 'ok' }).statusCode, 200);
  assert.equal(save({ label: 5 }).statusCode, 200);
  assert.equal(settingsModel.raw(ID, 'label'), '5');
  assert.equal(save({ label: true }).statusCode, 200);
  assert.equal(settingsModel.raw(ID, 'label'), 'true');
  assert.equal(save({ label: '' }).statusCode, 200);
  assert.equal(settingsModel.raw(ID, 'label'), '');
  assert.equal(save({ checked: 'bad' }).statusCode, 400);
});

test('R23-P1 — a boolean or a number replaces no secret, and writes nothing', () => {
  const { save, settingsModel } = boot();
  assert.equal(save({ apiKey: 'the-real-key' }).statusCode, 200);
  for (const value of [true, false, 12, 0]) {
    const res = save({ apiKey: value });
    assert.equal(res.statusCode, 400, JSON.stringify(value));
    assert.equal(res.body.error, 'INVALID_SETTING');
    assert.equal(res.body.errors.apiKey, 'Valeur invalide.');
  }
  assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), 'the-real-key');
  assert.equal(save({ apiKey: 'replaced' }).statusCode, 200);
  assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), 'replaced');
  assert.equal(save({ apiKey: null }).statusCode, 200, 'null still clears a plugin secret (rule 7)');
  assert.equal(settingsModel.get(ID, 'apiKey', { secret: true }), '');
});

test('R23-P1 — a boolean never passes a validator as a number; a key with no validator keeps its reading', () => {
  const { save, settingsModel } = boot();
  for (const value of [true, false]) {
    const res = save({ checked: value });
    assert.equal(res.statusCode, 400, JSON.stringify(value));
    assert.equal(res.body.errors.checked, 'Valeur invalide.');
  }
  assert.deepEqual(validated, []);
  assert.equal(save({ checked: 'good' }).statusCode, 200);
  assert.equal(save({ checked: 3 }).statusCode, 200);
  assert.equal(save({ label: true }).statusCode, 200);
  assert.equal(settingsModel.raw(ID, 'label'), 'true');
});
