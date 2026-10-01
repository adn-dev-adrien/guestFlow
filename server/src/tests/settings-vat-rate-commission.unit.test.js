const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');

// accounting-platform-commission-and-no-deposit.md §3.7 rule 17b + §7.1. The commission and
// cancellation-indemnity rates (and their accounts) moved to the accounting-export plugin's settings
// (specs/plugins-phase-2-hosts.md rule 19): the core settings model no longer reads or writes them,
// and their app_settings columns stay in place, unread. The plugin's tests cover the new store.

const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    googleCalendarId TEXT DEFAULT '',
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
    smtpSecure INTEGER NOT NULL DEFAULT 0,
    smtpUsername TEXT DEFAULT '',
    smtpPasswordEncrypted TEXT DEFAULT '',
    smtpFromEmail TEXT DEFAULT '',
    smtpFromName TEXT DEFAULT 'GuestFlow',
    publicUrl TEXT DEFAULT '',
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

test('the core settings model no longer reads the accounting rates and accounts', () => {
  const { model } = freshModel();
  const row = model.read();
  assert.equal('vatRateCommission' in row, false);
  assert.equal('defaultCommissionAccountNumber' in row, false);
  assert.equal(row.vatRate, 10);
});

test('the core settings model no longer writes them; GET /settings does not carry them', () => {
  const { model, db } = freshModel();
  model.upsert({ vatRate: 5.5, vatRateCommission: 19.6, defaultCommissionAccountNumber: '62260001' });
  const stored = db.prepare('SELECT vatRateCommission, defaultCommissionAccountNumber FROM app_settings WHERE id = 1').get();
  assert.equal(stored.vatRateCommission, 20, 'the old column keeps its value, unread');
  assert.equal(stored.defaultCommissionAccountNumber, '622600');
  const shaped = shapeResponse(model.read());
  assert.equal(shaped.vat.rate, 5.5);
  assert.equal('rateCommission' in shaped.vat, false);
  assert.equal('rateCancellationCompensation' in shaped.vat, false);
});
