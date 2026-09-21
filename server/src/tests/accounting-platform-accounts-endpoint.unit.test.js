const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const platformAccountsModel = require('../models/platformAccountsModel');
const platformsModel = require('../models/platformsModel');
const settingsModel = require('../models/settingsModel');

// accounting-platform-commission-and-no-deposit.md §7.1 — model + endpoint behaviour.

// Mirrors settings-model.unit.test.js DDL so settingsModel.create(db) can read every column
// it lists in COLUMNS without a "no such column" error.
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
    vatRateCancellationCompensation REAL NOT NULL DEFAULT 0,
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
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, platformLabel TEXT NOT NULL DEFAULT '');
  CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT,
    hasVatOnCommission INTEGER NOT NULL DEFAULT 0, commissionPercent REAL NOT NULL DEFAULT 0, color TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.prepare("INSERT INTO platforms (name) VALUES ('direct')").run();
  db.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  db.prepare("INSERT INTO platforms (name) VALUES ('Gîtes de France')").run();
  const platforms = platformsModel.create(db);
  const settings = settingsModel.create(db);
  return { model: platformAccountsModel.create(db, { platforms, settings }), db, platforms, settings };
}

test('getAll returns defaults + every platform with isDirect flag', () => {
  const { model } = freshModel();
  const out = model.getAll();
  assert.equal(out.defaultAccount, '622600');
  assert.equal(out.vatRateCommission, 20);
  const direct = out.platforms.find((p) => p.name === 'direct');
  assert.ok(direct.isDirect);
  const airbnb = out.platforms.find((p) => p.name === 'Airbnb');
  assert.equal(airbnb.isDirect, false);
  assert.equal(airbnb.commissionAccountNumber, null);
  assert.equal(airbnb.hasVatOnCommission, false);
});

test('saveAll persists default account + per-platform rows', () => {
  const { model } = freshModel();
  const res = model.saveAll({
    defaultAccount: '62260000',
    platforms: [
      { id: 2, account: '62260300', hasVat: false },     // Airbnb
      { id: 3, account: '62260500', hasVat: true  },     // Gîtes de France
    ],
  });
  assert.equal(res.ok, true);
  const out = model.getAll();
  assert.equal(out.defaultAccount, '62260000');
  const gdf = out.platforms.find((p) => p.name === 'Gîtes de France');
  assert.equal(gdf.commissionAccountNumber, '62260500');
  assert.equal(gdf.hasVatOnCommission, true);
});

test('saveAll rejects an invalid (non-numeric) default account', () => {
  const { model } = freshModel();
  const res = model.saveAll({ defaultAccount: 'abc', platforms: [] });
  assert.equal(res.status, 400);
  assert.ok(res.error.defaultAccount);
});

test('saveAll requires the default account (cannot be cleared — rule 21)', () => {
  const { model } = freshModel();
  const res = model.saveAll({ defaultAccount: '', platforms: [] });
  assert.equal(res.status, 400);
  assert.ok(res.error.defaultAccount);
});

test('saveAll: empty per-platform account is OK (falls back to default at export)', () => {
  const { model } = freshModel();
  const res = model.saveAll({
    defaultAccount: '622600',
    platforms: [{ id: 2, account: '', hasVat: false }],
  });
  assert.equal(res.ok, true);
  const airbnb = res.data.platforms.find((p) => p.name === 'Airbnb');
  assert.equal(airbnb.commissionAccountNumber, null);
});

test('saveAll: per-platform invalid account (too few digits) → 400 + error pinned to the row id', () => {
  const { model } = freshModel();
  const res = model.saveAll({
    defaultAccount: '622600',
    platforms: [{ id: 2, account: '12', hasVat: false }],
  });
  assert.equal(res.status, 400);
  assert.ok(res.error.platforms);
  assert.equal(res.error.platforms[0].id, 2);
  assert.ok(res.error.platforms[0].account);
});

test('saveAll: write targeting the Direct row is silently ignored', () => {
  const { model } = freshModel();
  const res = model.saveAll({
    defaultAccount: '622600',
    platforms: [{ id: 1, account: '99999999', hasVat: true }],
  });
  assert.equal(res.ok, true);
  const direct = res.data.platforms.find((p) => p.name === 'direct');
  assert.equal(direct.commissionAccountNumber, null);
  assert.equal(direct.hasVatOnCommission, false);
});

test('the two accounting VAT rates are edited here (specs/settings-rationalization.md rule 14)', () => {
  const { model } = freshModel();
  const res = model.saveAll({ defaultAccount: '622600', platforms: [], vatRateCommission: '19,6', vatRateCancellationCompensation: 5.5 });
  assert.equal(res.ok, true);
  assert.equal(model.getAll().vatRateCommission, 19.6);
  assert.equal(model.getAll().vatRateCancellationCompensation, 5.5);
  // Absent key ⇒ untouched.
  model.saveAll({ defaultAccount: '622600', platforms: [] });
  assert.equal(model.getAll().vatRateCommission, 19.6);
});

test('an accounting VAT rate out of 0-100 or empty refuses the whole save', () => {
  const { model } = freshModel();
  const res = model.saveAll({ defaultAccount: '62260001', platforms: [], vatRateCommission: 120, vatRateCancellationCompensation: '' });
  assert.equal(res.status, 400);
  assert.ok(res.error.vatRateCommission);
  assert.ok(res.error.vatRateCancellationCompensation);
  assert.notEqual(model.getAll().defaultAccount, '62260001', 'nothing was written');
});

test('saveAll round-trips empty platforms (no-op on per-platform rows)', () => {
  const { model } = freshModel();
  const res = model.saveAll({ defaultAccount: '62260001', platforms: [] });
  assert.equal(res.ok, true);
  assert.equal(res.data.defaultAccount, '62260001');
});

test('refresh returns the updated list + newCount when the DB grows', () => {
  const { model, db, platforms } = freshModel();
  // Add a `reservations` table after the fact + a fresh platform via a manual reservation.
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT)');
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('Booking');
  // Also a new iCal source.
  db.prepare('INSERT INTO ical_sources (platformLabel) VALUES (?)').run('Greengo');

  const result = model.refresh();
  assert.equal(result.newCount, 2);
  const names = result.data.platforms.map((p) => p.name).sort();
  assert.ok(names.includes('Booking'));
  assert.ok(names.includes('Greengo'));

  // Idempotent — second refresh adds nothing.
  const again = model.refresh();
  assert.equal(again.newCount, 0);

  // platformsModel is the source of truth — the rescan ran against the same db handle.
  void platforms;
});
