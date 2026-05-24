const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');

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

test('settingsModel.read: defaults on a fresh row', () => {
  const { model } = freshModel();
  const row = model.read();
  assert.equal(row.googleCalendarId, '');
  assert.equal(row.companyName, '');
  assert.equal(row.quoteValidityDays, 30);
  assert.equal(row.companyLogoPath, '');
});

test('settingsModel.upsert: writes only the keys present in payload', () => {
  const { model } = freshModel();
  model.upsert({ companyName: '  Acme  ', companyEmail: 'a@b.com' });
  const row = model.read();
  // Note: the model trims via String() but does not auto-trim — that is the controller's job.
  // We just verify the values made it to disk.
  assert.match(row.companyName, /Acme/);
  assert.equal(row.companyEmail, 'a@b.com');
  // Untouched fields preserved at default.
  assert.equal(row.companyAddress, '');
});

test('settingsModel.upsert: subsequent calls preserve untouched columns', () => {
  const { model } = freshModel();
  model.upsert({ companyName: 'Acme', companyEmail: 'a@b.com' });
  model.upsert({ companyPhone: '0102030405' });
  const row = model.read();
  assert.equal(row.companyName, 'Acme');
  assert.equal(row.companyEmail, 'a@b.com');
  assert.equal(row.companyPhone, '0102030405');
});

test('settingsModel.upsert: clears a string field when set to ""', () => {
  const { model } = freshModel();
  model.upsert({ googleServiceAccountPrivateKey: 'KEY' });
  assert.equal(model.read().googleServiceAccountPrivateKey, 'KEY');
  model.upsert({ googleServiceAccountPrivateKey: '' });
  assert.equal(model.read().googleServiceAccountPrivateKey, '');
});

test('settingsModel.updateLogoPath: updates only that column', () => {
  const { model } = freshModel();
  model.upsert({ companyName: 'Acme' });
  model.updateLogoPath('/uploads/x.png');
  const row = model.read();
  assert.equal(row.companyLogoPath, '/uploads/x.png');
  assert.equal(row.companyName, 'Acme');
});

test('settingsModel.upsert: refreshes updatedAt', () => {
  const { model } = freshModel();
  model.upsert({ companyName: 'A' });
  const first = model.read().updatedAt;
  const start = Date.now();
  while (Date.now() - start < 1100) { /* spin so SQLite datetime("now") advances */ }
  model.upsert({ companyName: 'B' });
  const second = model.read().updatedAt;
  assert.notEqual(first, second);
});
