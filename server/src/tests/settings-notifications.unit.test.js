const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');

/**
 * Booking-notification settings (specs/site-booking-notifications.md §5). Non-secret columns
 * `notificationsEnabled` (default ON) + `notificationRecipientEmail` (empty → falls back to the
 * SMTP sender), surfaced under a `notifications` block in the settings payload.
 */

function freshModel({ withColumns = true } = {}) {
  const db = new Database(':memory:');
  // companyLogoPath is required because settingsModel.create() eagerly prepares an updateLogoStmt
  // against it at build time.
  db.exec(`CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    companyLogoPath TEXT DEFAULT '',
    smtpHost TEXT DEFAULT '',
    smtpFromEmail TEXT DEFAULT '',
    publicUrl TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
    ${withColumns ? ", notificationsEnabled INTEGER NOT NULL DEFAULT 1, notificationRecipientEmail TEXT DEFAULT ''" : ''}
  )`);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { model: settingsModel.create(db), db };
}

test('defaults: notifications enabled ON, recipient empty on a fresh DB', () => {
  const { model } = freshModel();
  const notif = model.notificationSettings();
  assert.equal(notif.enabled, true, 'ON by default');
  assert.equal(notif.recipientEmail, '');

  const shaped = shapeResponse(model.read());
  assert.equal(shaped.notifications.enabled, true);
  assert.equal(shaped.notifications.recipientEmail, '');
});

test('upsert persists the toggle + recipient and surfaces them', () => {
  const { model } = freshModel();
  model.upsert({ notificationsEnabled: 0, notificationRecipientEmail: 'owner@example.com' });

  const notif = model.notificationSettings();
  assert.equal(notif.enabled, false, 'switched OFF');
  assert.equal(notif.recipientEmail, 'owner@example.com');

  const shaped = shapeResponse(model.read());
  assert.equal(shaped.notifications.enabled, false);
  assert.equal(shaped.notifications.recipientEmail, 'owner@example.com');
});

test('recipient falls back to the SMTP sender via notificationSettings (fromEmail surfaced)', () => {
  const { model } = freshModel();
  model.upsert({ smtpFromEmail: 'noreply@example.com' });
  const notif = model.notificationSettings();
  assert.equal(notif.recipientEmail, '', 'no explicit recipient');
  assert.equal(notif.fromEmail, 'noreply@example.com', 'sender available for the fallback');
});

test('partial/old DB without the columns still defaults to enabled ON (no crash)', () => {
  const { model } = freshModel({ withColumns: false });
  // notificationsEnabled column absent → Number(undefined) !== 0 → ON (safe default).
  assert.equal(model.notificationSettings().enabled, true);
  assert.equal(shapeResponse(model.read()).notifications.enabled, true);
});
