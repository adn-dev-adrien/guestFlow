const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Encrypted Google fields need a key; set one in env so the test stays hermetic (no .env.local writes).
process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

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
    vatRateAccommodation REAL DEFAULT 10,
    vatRateStandard REAL DEFAULT 20,
    smtpHost TEXT DEFAULT '',
    smtpPort INTEGER DEFAULT 587,
    smtpSecure INTEGER NOT NULL DEFAULT 0,
    smtpUsername TEXT DEFAULT '',
    smtpPasswordEncrypted TEXT DEFAULT '',
    smtpFromEmail TEXT DEFAULT '',
    smtpFromName TEXT DEFAULT 'GuestFlow',
    publicUrl TEXT DEFAULT '',
    allowEditPastReservations INTEGER NOT NULL DEFAULT 0,
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

// ----- SMTP wiring (specs/admin-account-management.md M3) -----

test('settingsModel.read masks the SMTP password: smtpPasswordEncrypted gone, smtpPasswordSet boolean instead', () => {
  const { model } = freshModel();
  model.upsert({ smtpHost: 'smtp.example.com', smtpFromEmail: 'no-reply@example.com', smtpPasswordEncrypted: 'secret-pw' });
  const r = model.read();
  assert.equal(r.smtpHost, 'smtp.example.com');
  assert.equal(r.smtpFromEmail, 'no-reply@example.com');
  assert.equal(r.smtpPasswordSet, true, 'mask boolean present + true');
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'smtpPasswordEncrypted'), false, 'encrypted column never returned');
});

test('settingsModel.smtpConfigured: false until host + fromEmail are both set', () => {
  const { model } = freshModel();
  assert.equal(model.smtpConfigured(), false);
  model.upsert({ smtpHost: 'smtp.example.com' });
  assert.equal(model.smtpConfigured(), false, 'host alone is not enough');
  model.upsert({ smtpFromEmail: 'no-reply@example.com' });
  assert.equal(model.smtpConfigured(), true);
});

test('settingsModel.decryptedSmtpSettings returns the shape the email service expects', () => {
  const { model } = freshModel();
  model.upsert({
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: 1,
    smtpUsername: 'noreply@example.com',
    smtpPasswordEncrypted: 'real-secret',
    smtpFromEmail: 'noreply@example.com',
    smtpFromName: 'GuestFlow Team',
  });
  const s = model.decryptedSmtpSettings();
  assert.deepEqual(s, {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'noreply@example.com',
    password: 'real-secret',
    fromEmail: 'noreply@example.com',
    fromName: 'GuestFlow Team',
  });
});

test('settingsModel.publicUrl returns the configured URL (trimmed)', () => {
  const { model } = freshModel();
  assert.equal(model.publicUrl(), '');
  model.upsert({ publicUrl: '  https://guestflow.example.com  ' });
  assert.equal(model.publicUrl(), 'https://guestflow.example.com');
});

// ---------- allowEditPastReservations toggle (specs/admin-unlock-past-reservations.md) ----------

test('settingsModel.allowEditPastReservations: false by default on a fresh row', () => {
  const { model } = freshModel();
  assert.equal(model.allowEditPastReservations(), false);
  // The raw column is also exposed via read() as an integer (mirrors smtpSecure shape).
  assert.equal(model.read().allowEditPastReservations, 0);
});

test('settingsModel: upsert({ allowEditPastReservations: true }) → 1 → helper returns true', () => {
  const { model } = freshModel();
  model.upsert({ allowEditPastReservations: true });
  assert.equal(model.read().allowEditPastReservations, 1);
  assert.equal(model.allowEditPastReservations(), true);
});

test('settingsModel: upsert({ allowEditPastReservations: false }) flips back to 0 → helper returns false', () => {
  const { model } = freshModel();
  model.upsert({ allowEditPastReservations: true });
  assert.equal(model.allowEditPastReservations(), true);
  model.upsert({ allowEditPastReservations: false });
  assert.equal(model.read().allowEditPastReservations, 0);
  assert.equal(model.allowEditPastReservations(), false);
});

test('settingsModel: upsert coerces truthy/falsy variants via the numeric-default coercion', () => {
  // The upsert path runs Number(v) for any NUMERIC_DEFAULTS column. Confirm the coercion
  // table matches what the client may send (booleans straight from a Switch, or 0/1 from
  // a hand-rolled curl).
  const cases = [
    { input: true, expected: 1, expectedBool: true },
    { input: 1, expected: 1, expectedBool: true },
    { input: false, expected: 0, expectedBool: false },
    { input: 0, expected: 0, expectedBool: false },
  ];
  for (const c of cases) {
    const { model } = freshModel();
    model.upsert({ allowEditPastReservations: c.input });
    assert.equal(
      model.read().allowEditPastReservations,
      c.expected,
      `expected raw=${c.expected} for input=${JSON.stringify(c.input)}`,
    );
    assert.equal(
      model.allowEditPastReservations(),
      c.expectedBool,
      `expected helper=${c.expectedBool} for input=${JSON.stringify(c.input)}`,
    );
  }
});

test('settingsModel: upsert({}) preserves allowEditPastReservations through unrelated updates', () => {
  const { model } = freshModel();
  model.upsert({ allowEditPastReservations: true });
  // A subsequent upsert touching other fields must not reset the toggle.
  model.upsert({ companyName: 'Acme' });
  assert.equal(model.allowEditPastReservations(), true);
});
