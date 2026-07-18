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
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return db;
}

const REFRESH_TOKEN = '1//0gRefreshTokenSampleValue-abcdef123456';

test('Google OAuth refresh token is stored encrypted and never read back in clear', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.storeGoogleTokens({ refreshToken: REFRESH_TOKEN, email: 'adrien@example.com' });

  const stored = db.prepare('SELECT googleOAuthRefreshTokenEncrypted AS t, googleOAuthConnectedEmail AS e FROM app_settings WHERE id = 1').get();
  assert.ok(isEncrypted(stored.t), 'stored token must be encrypted');
  assert.equal(stored.e, 'adrien@example.com', 'connection metadata stays plaintext');

  // read() masks the blob to the googleConnected boolean — the token never leaves the model.
  const row = model.read();
  assert.equal(row.googleConnected, true);
  assert.equal(row.googleOAuthRefreshTokenEncrypted, undefined);
  assert.equal(JSON.stringify(row).includes(REFRESH_TOKEN), false);

  // Internal accessor decrypts for the sync engine only.
  assert.equal(model.googleTokens().refreshToken, REFRESH_TOKEN);
  assert.equal(model.googleConnected(), true);
});

test('googleCalendarId round-trips encrypted at rest, clear on read', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.storeGoogleCalendarSelection({ calendarId: 'agenda@group.calendar.google.com', summary: 'Agenda pro' });

  const stored = db.prepare('SELECT googleCalendarId AS c, googleCalendarSummary AS s FROM app_settings WHERE id = 1').get();
  assert.ok(isEncrypted(stored.c), 'calendar id encrypted at rest');
  assert.equal(stored.s, 'Agenda pro');

  assert.deepEqual(model.googleCalendarSelection(), {
    calendarId: 'agenda@group.calendar.google.com',
    summary: 'Agenda pro',
  });
});

test('migrateEncryption encrypts a legacy cleartext value exactly once', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  // Simulate a value written before encryption existed.
  db.prepare('UPDATE app_settings SET googleCalendarId = ? WHERE id = 1').run('legacy@calendar');

  model.migrateEncryption();
  const afterFirst = db.prepare('SELECT googleCalendarId AS c FROM app_settings WHERE id = 1').get().c;
  assert.ok(isEncrypted(afterFirst));
  assert.equal(model.read().googleCalendarId, 'legacy@calendar');

  // Idempotent: a second run does not double-encrypt.
  model.migrateEncryption();
  const afterSecond = db.prepare('SELECT googleCalendarId AS c FROM app_settings WHERE id = 1').get().c;
  assert.equal(afterSecond, afterFirst);
  assert.equal(model.read().googleCalendarId, 'legacy@calendar');
});

test('empty credential stays empty (no encryption of blank)', () => {
  const db = makeDb();
  const model = settingsModel.create(db);
  model.upsert({ googleOAuthRefreshTokenEncrypted: '' });
  const stored = db.prepare('SELECT googleOAuthRefreshTokenEncrypted AS t FROM app_settings WHERE id = 1').get().t;
  assert.equal(stored, '');
  assert.equal(model.googleConnected(), false);
  assert.equal(model.googleTokens().refreshToken, '');
});

test('recordGoogleSyncResult keeps the tri-state and clearGoogleConnection resets everything', () => {
  const db = makeDb();
  const model = settingsModel.create(db);

  // Never ran → NULL.
  assert.equal(model.googleStatus().lastSyncOk, null);

  model.storeGoogleTokens({ refreshToken: REFRESH_TOKEN, email: 'adrien@example.com' });
  model.storeGoogleCalendarSelection({ calendarId: 'cal-1', summary: 'Agenda pro' });
  model.recordGoogleSyncResult({ ok: false, detail: '1 erreur' });
  let s = model.googleStatus();
  assert.equal(s.lastSyncOk, false);
  assert.equal(s.lastSyncDetail, '1 erreur');
  assert.ok(s.lastSyncAt);

  model.recordGoogleSyncResult({ ok: true, detail: '3 envoyée(s)' });
  assert.equal(model.googleStatus().lastSyncOk, true);

  model.clearGoogleConnection();
  s = model.googleStatus();
  assert.equal(s.connected, false);
  assert.equal(s.connectedEmail, '');
  assert.equal(s.calendarId, '');
  assert.equal(s.calendarSummary, '');
  assert.equal(s.lastSyncAt, null);
  assert.equal(s.lastSyncOk, null);
  assert.equal(s.lastSyncDetail, '');
});
