const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');

/**
 * Accounting closing month (specs/fiscal-year-and-nights-sold.md §3.1 + §5). Plain non-secret
 * integer column on the app_settings singleton, surfaced under an `accounting` block. Default 12 =
 * calendar year, i.e. the behaviour every annual figure had before this spec.
 */

function freshModel({ withColumn = true } = {}) {
  const db = new Database(':memory:');
  // companyLogoPath is required because settingsModel.create() eagerly prepares an updateLogoStmt
  // against it at build time.
  db.exec(`CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    companyLogoPath TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
    ${withColumn ? ', fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12' : ''}
  )`);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { model: settingsModel.create(db), db };
}

test('default: a fresh DB closes in December — the exercise is the calendar year', () => {
  const { model } = freshModel();
  assert.equal(shapeResponse(model.read()).accounting.fiscalYearEndMonth, 12);
});

test('upsert persists the closing month and surfaces it under `accounting`', () => {
  const { model } = freshModel();
  model.upsert({ fiscalYearEndMonth: 9 });
  assert.equal(model.read().fiscalYearEndMonth, 9);
  assert.equal(shapeResponse(model.read()).accounting.fiscalYearEndMonth, 9);
});

test('the closing month is NOT encrypted — it is stored as a plain integer', () => {
  const { model, db } = freshModel();
  model.upsert({ fiscalYearEndMonth: 9 });
  const raw = db.prepare('SELECT fiscalYearEndMonth FROM app_settings WHERE id = 1').get();
  assert.equal(raw.fiscalYearEndMonth, 9);
});

test('an untouched upsert preserves the stored month (per-field semantics)', () => {
  const { model } = freshModel();
  model.upsert({ fiscalYearEndMonth: 9 });
  model.upsert({ companyLogoPath: '/uploads/logo.png' });
  assert.equal(shapeResponse(model.read()).accounting.fiscalYearEndMonth, 9);
});

test('a pre-migration DB without the column still reads as December (no crash)', () => {
  const { model } = freshModel({ withColumn: false });
  assert.equal(shapeResponse(model.read()).accounting.fiscalYearEndMonth, 12);
});
