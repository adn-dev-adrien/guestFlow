// specs/booking-extranet-intake.md rules 25-26 — the secret is created by an explicit POST, never by
// the GET that serves the script; and the three routes that create, hand out or rotate it are refused
// to a support session (specs/hosting-h2-account-security.md rule 23).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bi-secret-')), 'core.db');
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
const silent = console.log;
console.log = () => {};
const coreDb = require('../../../database');
console.log = silent;

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const bookingIntake = require('..');
const { forbiddenReason } = require('../../../utils/supportSessionPolicy');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function boot() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  plugins.install('booking-intake');
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [bookingIntake], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const record = registry.get('booking-intake');
  return { settingsModel, record };
}

async function serve(record) {
  const app = express();
  app.use(express.json());
  record.mounts.filter((m) => !m.public).forEach((m) => app.use(m.path, m.router));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/booking-intake`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('specs/booking-extranet-intake.md rule 25: the GET of the script writes nothing; POST /secret creates the secret once', async () => {
  coreDb.prepare("UPDATE app_settings SET publicUrl = 'https://guestflow.example' WHERE id = 1").run();
  const { settingsModel, record } = boot();
  const s = await serve(record);
  const stored = () => settingsModel.raw('booking-intake', 'key');

  const before = await fetch(`${s.base}/userscript.user.js`);
  assert.equal(before.status, 409);
  assert.deepEqual(await before.json(), { error: 'Secret non créé.' });
  assert.ok(!stored(), 'a GET never creates the secret');

  const created = await (await fetch(`${s.base}/secret`, { method: 'POST' })).json();
  assert.deepEqual(created, { ok: true, created: true });
  const first = stored();
  assert.ok(first);
  assert.deepEqual(await (await fetch(`${s.base}/secret`, { method: 'POST' })).json(), { ok: true, created: false });
  assert.equal(stored(), first, 'a second POST keeps the installed script working');

  const script = await fetch(`${s.base}/userscript.user.js`);
  assert.equal(script.status, 200);
  const key = settingsModel.get('booking-intake', 'key', { secret: true });
  assert.ok((await script.text()).includes(key));
  assert.equal(stored(), first, 'serving the script leaves the secret as it is');
  await s.close();
});

test('specs/booking-extranet-intake.md rule 26: a support session is refused the script and the secret routes, any case, any trailing slash', () => {
  boot();
  for (const [method, p] of [
    ['GET', '/booking-intake/userscript.user.js'],
    ['HEAD', '/booking-intake/userscript.user.js'],
    ['GET', '/Booking-Intake/Userscript.User.js/'],
    ['POST', '/booking-intake/secret'],
    ['POST', '/booking-intake/secret/regenerate'],
    ['POST', '/BOOKING-INTAKE/Secret/Regenerate/'],
  ]) {
    assert.equal(forbiddenReason(method, p, {}), 'credentials', `${method} ${p}`);
  }
  assert.equal(forbiddenReason('GET', '/booking-intake/pending', {}), null, 'the rest of the plugin stays readable');
  assert.equal(forbiddenReason('GET', '/booking-intake/intakes', {}), null);
});
