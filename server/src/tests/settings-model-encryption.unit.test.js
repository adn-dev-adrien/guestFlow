const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const settingsModel = require('../models/settingsModel');
const { isEncrypted } = require('../utils/encryption');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY,
      googleCalendarId TEXT DEFAULT '',
      googleOAuthRefreshTokenEncrypted TEXT DEFAULT '',
      googleOAuthConnectedEmail TEXT DEFAULT '',
      googleOAuthConnectedAt TEXT DEFAULT '',
      googleCalendarSummary TEXT DEFAULT '',
      googleLastSyncAt TEXT DEFAULT '',
      googleLastSyncOk INTEGER DEFAULT NULL,
      googleLastSyncDetail TEXT DEFAULT '',
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
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return db;
}

test('migrateEncryption encrypts a legacy cleartext value exactly once', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  // Simulate a value written before encryption existed.
  db.prepare('UPDATE app_settings SET smtpPasswordEncrypted = ? WHERE id = 1').run('legacy-password');

  model.migrateEncryption();
  const afterFirst = db.prepare('SELECT smtpPasswordEncrypted AS c FROM app_settings WHERE id = 1').get().c;
  assert.ok(isEncrypted(afterFirst));
  assert.equal(model.decryptedSmtpSettings().password, 'legacy-password');

  // Idempotent: a second run does not double-encrypt.
  model.migrateEncryption();
  const afterSecond = db.prepare('SELECT smtpPasswordEncrypted AS c FROM app_settings WHERE id = 1').get().c;
  assert.equal(afterSecond, afterFirst);
  assert.equal(model.decryptedSmtpSettings().password, 'legacy-password');
});

test('empty credential stays empty (no encryption of blank)', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.upsert({ smtpPasswordEncrypted: '' });
  const stored = db.prepare('SELECT smtpPasswordEncrypted AS t FROM app_settings WHERE id = 1').get().t;
  assert.equal(stored, '');
  assert.equal(model.read().smtpPasswordSet, false);
});
