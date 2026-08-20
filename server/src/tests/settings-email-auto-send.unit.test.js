const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');
const { autoSendAllowed } = require('../utils/autoSendPolicy');

/**
 * The automatic-send master switch, end to end through the settings layer
 * (specs/no-automatic-email-without-approval.md §3 rule 1 + §4.3).
 *
 * The column is `emailAutoSendEnabled` (INTEGER 0/1, default 0) and it surfaces under an `emails`
 * block. What matters most here is the DEFAULT: off, including on a database that predates the
 * column — the whole point of the feature is that silence means « ask me ».
 */

function freshModel({ withColumn = true } = {}) {
  const db = new Database(':memory:');
  // companyLogoPath is required: settingsModel.create() eagerly prepares an updateLogoStmt on it.
  db.exec(`CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    companyLogoPath TEXT DEFAULT '',
    smtpHost TEXT DEFAULT '',
    smtpFromEmail TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
    ${withColumn ? ', emailAutoSendEnabled INTEGER NOT NULL DEFAULT 0' : ''}
  )`);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { model: settingsModel.create(db), db };
}

test('default: automatic sending is OFF on a fresh database', () => {
  const { model } = freshModel();
  assert.equal(model.emailAutoSendEnabled(), false);
  assert.equal(shapeResponse(model.read()).emails.autoSendEnabled, false);
  assert.equal(autoSendAllowed(model), false);
});

test('a database that predates the column reads as OFF, not as ON', () => {
  // The upgrade path: until the migration runs, GuestFlow must behave as if the operator said no.
  const { model } = freshModel({ withColumn: false });
  assert.equal(model.emailAutoSendEnabled(), false);
  assert.equal(shapeResponse(model.read()).emails.autoSendEnabled, false);
  assert.equal(autoSendAllowed(model), false);
});

test('upsert turns it on and off, and the payload follows', () => {
  const { model } = freshModel();

  model.upsert({ emailAutoSendEnabled: 1 });
  assert.equal(model.emailAutoSendEnabled(), true);
  assert.equal(shapeResponse(model.read()).emails.autoSendEnabled, true);
  assert.equal(autoSendAllowed(model), true);

  model.upsert({ emailAutoSendEnabled: 0 });
  assert.equal(model.emailAutoSendEnabled(), false);
  assert.equal(shapeResponse(model.read()).emails.autoSendEnabled, false);
});

test('only an explicit 1 authorises automatic sending', () => {
  // The column is NOT NULL, so the ambiguous case cannot even be stored: an authorisation is either
  // there as a 1, or it is not. (The « column missing entirely » case is covered above.)
  const { model, db } = freshModel();
  assert.throws(
    () => db.prepare('UPDATE app_settings SET emailAutoSendEnabled = NULL WHERE id = 1').run(),
    /NOT NULL/,
  );
  db.prepare('UPDATE app_settings SET emailAutoSendEnabled = 0 WHERE id = 1').run();
  assert.equal(model.emailAutoSendEnabled(), false);
  db.prepare('UPDATE app_settings SET emailAutoSendEnabled = 1 WHERE id = 1').run();
  assert.equal(model.emailAutoSendEnabled(), true);
});

test('turning the switch on leaves the other settings alone', () => {
  const { model } = freshModel();
  model.upsert({ smtpHost: 'smtp.example.com', smtpFromEmail: 'from@example.com' });
  model.upsert({ emailAutoSendEnabled: 1 });

  const row = model.read();
  assert.equal(row.smtpHost, 'smtp.example.com');
  assert.equal(row.smtpFromEmail, 'from@example.com');
  assert.equal(shapeResponse(row).emails.autoSendEnabled, true);
});
