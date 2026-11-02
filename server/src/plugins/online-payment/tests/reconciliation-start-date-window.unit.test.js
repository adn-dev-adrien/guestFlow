// specs/qonto-bank-reconciliation.md rule 48 (audit R20-P1) and specs/reservations-backend-mvc.md rule 13 — the
// reconciliation start date is an entered date: a real day from today − 5 years to today + 5 years, judged on the
// generic settings PUT; the stored value is not re-judged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-op-start-')), 'core.db');
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
const silent = console.log;
console.log = () => {};
require('../../../database');
console.log = silent;

const registry = require('../../sdk/registry');
const loader = require('../../loader');
const onlinePayment = require('..');
const { buildModel: buildPluginsModel } = require('../../../models/pluginsModel');
const { buildModel: buildPluginSettingsModel } = require('../../../models/pluginSettingsModel');
const { createController } = require('../../../controllers/pluginsController');
const { ensurePluginsTable, ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const { applyPluginSchema } = require('../../sdk/testing');
const { horizonStart, horizonEnd } = require('../../../utils/stayDates');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const ID = 'online-payment';
const KEY = 'reconciliationStartDate';
const S = horizonStart();
const H = horizonEnd();
const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8'));
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  applyPluginSchema(db, ID);
  registry.reset();
  const plugins = buildPluginsModel(db);
  plugins.install(ID);
  registry.configure({ isActive: (id) => plugins.isActive(id) });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [onlinePayment], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  const controller = createController(plugins, { registry, settingsModel: () => settingsModel });
  const put = (value) => {
    const res = fakeRes();
    controller.saveSettings({ params: { id: ID }, body: { [KEY]: value } }, res);
    return res;
  };
  return { settingsModel, put };
}

test('rule 48: the window bounds and an empty value are accepted', () => {
  const { settingsModel, put } = setup();
  for (const value of [S, H, '']) {
    const res = put(value);
    assert.equal(res.statusCode, 200, value);
    assert.equal(settingsModel.get(ID, KEY), value);
  }
});

test('rule 48: an impossible day, a half-typed year or a day outside the window is refused and nothing is written', () => {
  const { settingsModel, put } = setup();
  settingsModel.set(ID, KEY, S);
  const cases = [
    [`${H.slice(0, 4)}-02-30`, 'Date de mise en service invalide.'],
    ['0000-00-00', 'Date de mise en service invalide.'],
    [`${H.slice(0, 4)}-13-45`, 'Date de mise en service invalide.'],
    [`000${S.slice(3, 4)}${S.slice(4)}`, 'Date trop ancienne : 5 ans au plus.'],
    [addDaysToIsoDate(S, -1), 'Date trop ancienne : 5 ans au plus.'],
    [addDaysToIsoDate(H, 1), 'Date trop lointaine : 5 ans au plus.'],
  ];
  for (const [value, message] of cases) {
    const res = put(value);
    assert.equal(res.statusCode, 400, value);
    assert.equal(res.body.error, 'INVALID_SETTING');
    assert.equal(res.body.errors[KEY], message, value);
  }
  assert.equal(settingsModel.get(ID, KEY), S);
});

test('rule 48: a stored value outside the window is saved back unchanged; another one is still judged', () => {
  const { settingsModel, put } = setup();
  const stored = addDaysToIsoDate(S, -30);
  settingsModel.set(ID, KEY, stored);
  assert.equal(put(stored).statusCode, 200);
  assert.equal(settingsModel.get(ID, KEY), stored);
  assert.equal(put(addDaysToIsoDate(stored, 1)).statusCode, 400);
  assert.equal(settingsModel.get(ID, KEY), stored);
});
