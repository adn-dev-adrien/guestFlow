// specs/settings/settings-rationalization.md rule 14 — the VAT rate on commissions is the admin's: the accountant keeps
// editing the account numbers, a PUT that changes the rate is refused 403 and writes nothing.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const platformAccountsModel = require('../platformAccountsModel');
const platformAccountsController = require('../platformAccountsController');
const platformsModel = require('../../../models/platformsModel');
const { ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');

function fresh() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, platformLabel TEXT NOT NULL DEFAULT '');
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, commissionAccountNumber TEXT,
      hasVatOnCommission INTEGER NOT NULL DEFAULT 0, commissionPercent REAL NOT NULL DEFAULT 0, color TEXT
    );
  `);
  ensurePluginSettingsTable(db);
  db.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  const model = platformAccountsModel.create(db, { platforms: platformsModel.create(db) });
  return { model, controller: platformAccountsController.create(model) };
}

function put(controller, user, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.saveAll({ user, body }, res);
  return res;
}
const ACCOUNTANT = { roles: ['accountant'] };
const ADMIN = { roles: ['admin'] };

test('rule 14: an accountant changing the commission VAT rate is refused 403 and nothing is written', () => {
  const { model, controller } = fresh();
  const res = put(controller, ACCOUNTANT, { defaultAccount: '62260000', vatRateCommission: 5 });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Le taux de TVA des commissions est réservé à l\'administrateur.');
  assert.equal(model.getAll().vatRateCommission, 20);
  assert.equal(model.getAll().defaultAccount, '622600');
});

test('rule 14: an accountant editing the accounts only (or re-sending the stored rate) is accepted', () => {
  const { model, controller } = fresh();
  assert.equal(put(controller, ACCOUNTANT, { defaultAccount: '62260000' }).statusCode, 200);
  assert.equal(put(controller, ACCOUNTANT, { defaultAccount: '62260100', vatRateCommission: '20' }).statusCode, 200);
  assert.equal(model.getAll().defaultAccount, '62260100');
  assert.equal(model.getAll().vatRateCommission, 20);
});

test('rule 14: the admin changes the commission VAT rate', () => {
  const { model, controller } = fresh();
  const res = put(controller, ADMIN, { defaultAccount: '62260000', vatRateCommission: 5 });
  assert.equal(res.statusCode, 200);
  assert.equal(model.getAll().vatRateCommission, 5);
});
