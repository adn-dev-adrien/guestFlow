const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');

// accounting-platform-commission-and-no-deposit.md §3.7 rule 17b + §7.1.
// The global commission VAT rate sits next to vatRate in Settings → Général → Taux de TVA.

const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    googleCalendarId TEXT DEFAULT '',
    googleServiceAccountEmail TEXT DEFAULT '',
    googleServiceAccountPrivateKey TEXT DEFAULT '',
    companyName TEXT DEFAULT '',
    companyAddress TEXT DEFAULT '',
    companyEmail TEXT DEFAULT '',
    companyPhone TEXT DEFAULT '',
    companySiret TEXT DEFAULT '',
    companyTva TEXT DEFAULT '',
    companyIban TEXT DEFAULT '',
    companyBic TEXT DEFAULT '',
    companyBankName TEXT DEFAULT '',
    quoteFooterText TEXT DEFAULT '',
    quoteValidityDays INTEGER DEFAULT 30,
    companyLogoPath TEXT DEFAULT '',
    vatRate REAL NOT NULL DEFAULT 10,
    defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600',
    vatRateCommission REAL NOT NULL DEFAULT 20,
    smtpHost TEXT DEFAULT '',
    smtpPort INTEGER DEFAULT 587,
    smtpSecure INTEGER NOT NULL DEFAULT 0,
    smtpUsername TEXT DEFAULT '',
    smtpPasswordEncrypted TEXT DEFAULT '',
    smtpFromEmail TEXT DEFAULT '',
    smtpFromName TEXT DEFAULT 'GuestFlow',
    publicUrl TEXT DEFAULT '',
    allowEditPastReservations INTEGER NOT NULL DEFAULT 0,
    laundryWeekday INTEGER NOT NULL DEFAULT 2,
    bedLinenStockSingle INTEGER NOT NULL DEFAULT 0,
    bedLinenStockDouble INTEGER NOT NULL DEFAULT 0,
    bedLinenStockBaby INTEGER NOT NULL DEFAULT 0,
    towelStockLarge INTEGER NOT NULL DEFAULT 0,
    towelStockMedium INTEGER NOT NULL DEFAULT 0,
    towelStockSmall INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  return { model: settingsModel.create(db), db };
}

test('vatRateCommission defaults to 20 on a fresh row', () => {
  const { model } = freshModel();
  const row = model.read();
  assert.equal(row.vatRateCommission, 20);
});

test('vatRateCommission round-trips through upsert + shapeResponse', () => {
  const { model } = freshModel();
  model.upsert({ vatRateCommission: 19.6 });
  const row = model.read();
  assert.equal(row.vatRateCommission, 19.6);
  const shaped = shapeResponse(row);
  assert.equal(shaped.vat.rateCommission, 19.6);
});

test('shapeResponse exposes both vat.rate (revenue) and vat.rateCommission (commission)', () => {
  const { model } = freshModel();
  model.upsert({ vatRate: 5.5, vatRateCommission: 21 });
  const shaped = shapeResponse(model.read());
  assert.equal(shaped.vat.rate, 5.5);
  assert.equal(shaped.vat.rateCommission, 21);
});

test('shapeResponse falls back to 20 when vatRateCommission is somehow NULL', () => {
  const { db } = freshModel();
  // Side-channel NULL injection (shouldn't happen in prod given the NOT NULL DEFAULT, but
  // shapeResponse defends against it).
  const row = db.prepare('SELECT *, NULL AS vatRateCommission FROM app_settings WHERE id = 1').get();
  const shaped = shapeResponse(row);
  assert.equal(shaped.vat.rateCommission, 20);
});
