const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 26-27 — the annual revenue goal, one per exercise, in
// Settings → TVA & exercice. Validation, merge with what is stored, and the `accounting` response.

let stored = {};
let upserted = null;
require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { upserted = payload; stored = { ...stored, ...payload }; },
    read() { return stored; },
    updateLogoPath() {},
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};

const { updateSettings } = require('../controllers/settingsController');
const { shapeResponse } = require('../utils/settingsResponse');
const { parseGoalAmount, validateRevenueGoals, readRevenueGoals, mergeRevenueGoals, MESSAGES } = require('../utils/revenueGoals');

function call(accounting) {
  upserted = null;
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  updateSettings({ body: { accounting } }, res);
  return res;
}

test('rule 27 — accepted inputs: spaces, a decimal comma, a number, and empty for « no goal »', () => {
  assert.deepEqual(parseGoalAmount('85 000'), { ok: true, value: 85000 });
  assert.deepEqual(parseGoalAmount('85 000,50'), { ok: true, value: 85000.5 });
  assert.deepEqual(parseGoalAmount(120000), { ok: true, value: 120000 });
  assert.deepEqual(parseGoalAmount(''), { ok: true, value: null });
  assert.deepEqual(parseGoalAmount(null), { ok: true, value: null });
});

test('rule 27 — refusals carry the message the field shows', () => {
  assert.equal(parseGoalAmount('-5').error, MESSAGES.notPositive);
  assert.equal(parseGoalAmount('0').error, MESSAGES.notPositive);
  assert.equal(parseGoalAmount('85k').error, MESSAGES.notANumber);
  assert.equal(parseGoalAmount('12,345').error, MESSAGES.tooManyDecimals);
  assert.equal(parseGoalAmount('10000000.01').error, MESSAGES.tooHigh);
  assert.equal(parseGoalAmount(10000000).ok, true);
  assert.equal(validateRevenueGoals({ abc: 1 }).errors.abc, MESSAGES.badExercise);
});

test('rule 26 — goals are stored per exercise; an exercise left out keeps its goal, null removes it', () => {
  let json = mergeRevenueGoals(null, { 2026: 85000, 2027: null });
  assert.deepEqual(readRevenueGoals(json), { 2026: 85000 });
  json = mergeRevenueGoals(json, { 2027: 90000 });
  assert.deepEqual(readRevenueGoals(json), { 2026: 85000, 2027: 90000 });
  json = mergeRevenueGoals(json, { 2026: null, 2027: null });
  assert.equal(json, null);
  assert.deepEqual(readRevenueGoals('not json'), {});
});

test('rule 27 — the controller refuses an invalid goal with one error per exercise and writes nothing', () => {
  stored = {};
  const res = call({ revenueGoals: { 2026: '-5', 2027: '90 000' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.errors, { 'revenueGoals.2026': MESSAGES.notPositive });
  assert.equal(upserted, null);
});

test('rule 26 — the controller merges valid goals and the response exposes them under `accounting`', () => {
  stored = { revenueGoals: JSON.stringify({ 2025: 70000 }) };
  const res = call({ revenueGoals: { 2026: '85 000', 2027: '' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(upserted.revenueGoals), { 2025: 70000, 2026: 85000 });
  assert.deepEqual(shapeResponse(stored).accounting.revenueGoals, { 2025: 70000, 2026: 85000 });
  assert.deepEqual(shapeResponse({}).accounting.revenueGoals, {});
});

test('rules 26 + 28 — the goal context names the current and next exercise and carries the current revenue', () => {
  const Database = require('better-sqlite3');
  const financeModel = require('../models/financeModel');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER NOT NULL DEFAULT 9);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct', requestOrigin TEXT, attributionChannel TEXT,
      devisStatus TEXT, createdAt TEXT DEFAULT (datetime('now')), finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
      endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
      midStaySettledNotes TEXT, platformCommissionAmount REAL, acompteCommissionAmount REAL
    );
    INSERT INTO app_settings (id) VALUES (1);
    INSERT INTO properties (id, name) VALUES (1, 'Gite');
    INSERT INTO clients (id) VALUES (1);
  `);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO reservations (clientId, propertyId, startDate, endDate, balanceAmount) VALUES (1, 1, ?, ?, 400)").run(today, today);
  const ctx = financeModel.buildModel(db).getGoalContext();
  const [y, m] = today.split('-').map(Number);
  const currentKey = m <= 9 ? y : y + 1;
  assert.deepEqual(ctx.current, { key: currentKey, label: `${currentKey - 1}-${currentKey}`, revenue: 400 });
  assert.deepEqual(ctx.next, { key: currentKey + 1, label: `${currentKey}-${currentKey + 1}` });
});
