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
      vatRateAccommodation REAL DEFAULT 10,
      vatRateStandard REAL DEFAULT 20,
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return db;
}

const KEY = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n';

test('Google private key is stored encrypted but read back in clear', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.upsert({ googleServiceAccountPrivateKey: KEY, companyName: 'Acme' });

  const stored = db.prepare('SELECT googleServiceAccountPrivateKey, companyName FROM app_settings WHERE id = 1').get();
  assert.ok(isEncrypted(stored.googleServiceAccountPrivateKey), 'stored value must be encrypted');
  assert.equal(stored.companyName, 'Acme', 'non-credential columns stay plaintext');

  assert.equal(model.read().googleServiceAccountPrivateKey, KEY, 'read decrypts');
});

test('migrateEncryption encrypts a legacy cleartext row exactly once', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  // Simulate a legacy row written before encryption existed.
  db.prepare('UPDATE app_settings SET googleServiceAccountPrivateKey = ?, googleServiceAccountEmail = ? WHERE id = 1')
    .run(KEY, 'svc@example.com');

  model.migrateEncryption();
  const afterFirst = db.prepare('SELECT googleServiceAccountPrivateKey AS k FROM app_settings WHERE id = 1').get().k;
  assert.ok(isEncrypted(afterFirst));
  assert.equal(model.read().googleServiceAccountPrivateKey, KEY);

  // Idempotent: a second run does not double-encrypt.
  model.migrateEncryption();
  const afterSecond = db.prepare('SELECT googleServiceAccountPrivateKey AS k FROM app_settings WHERE id = 1').get().k;
  assert.equal(afterSecond, afterFirst);
  assert.equal(model.read().googleServiceAccountPrivateKey, KEY);
});

test('empty credential stays empty (no encryption of blank)', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.upsert({ googleServiceAccountPrivateKey: '' });
  const stored = db.prepare('SELECT googleServiceAccountPrivateKey AS k FROM app_settings WHERE id = 1').get().k;
  assert.equal(stored, '');
  assert.equal(model.read().googleServiceAccountPrivateKey, '');
});
