// specs/google-calendar-oauth-rework.md §5, stored per specs/plugins-phase-1-sdk.md rule 7 — the
// Google connection lives in plugin_settings: secrets encrypted at rest, tri-state last sync, full
// reset on disconnect. Moved from settings-model-encryption.unit.test.js with the accessors.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { buildModel } = require('../../../models/pluginSettingsModel');
const { ensurePluginSettingsTable } = require('../../../utils/pluginsSchema');
const { isEncrypted } = require('../../../utils/encryption');
const { createGoogleSettings, DECLARED } = require('../settings');

const REFRESH_TOKEN = '1//0gRefreshTokenSampleValue-abcdef123456';

function makeSettings() {
  const db = new Database(':memory:');
  ensurePluginSettingsTable(db);
  const model = buildModel(db);
  const secret = (key) => Boolean(DECLARED.find((k) => k.key === key).secret);
  const store = {
    get: (key) => model.get('google-calendar', key, { secret: secret(key) }),
    set: (key, value) => model.set('google-calendar', key, value, { secret: secret(key) }),
    raw: (key) => model.raw('google-calendar', key),
  };
  return { db, settings: createGoogleSettings({ store, publicUrl: () => '' }) };
}

const stored = (db, key) => (db.prepare("SELECT value FROM plugin_settings WHERE plugin_id = 'google-calendar' AND key = ?").get(key) || {}).value;

test('the refresh token is stored encrypted and only read back in clear internally', () => {
  const { db, settings } = makeSettings();
  settings.storeGoogleTokens({ refreshToken: REFRESH_TOKEN, email: 'adrien@example.com' });
  assert.ok(isEncrypted(stored(db, 'refreshToken')));
  assert.equal(stored(db, 'connectedEmail'), 'adrien@example.com');
  assert.equal(settings.googleTokens().refreshToken, REFRESH_TOKEN);
  assert.equal(settings.googleConnected(), true);
  assert.equal(settings.googleTokenBlob(), stored(db, 'refreshToken'));
});

test('the calendar id round-trips encrypted at rest, clear on read', () => {
  const { db, settings } = makeSettings();
  settings.storeGoogleCalendarSelection({ calendarId: 'agenda@group.calendar.google.com', summary: 'Agenda pro' });
  assert.ok(isEncrypted(stored(db, 'calendarId')));
  assert.equal(stored(db, 'calendarSummary'), 'Agenda pro');
  assert.deepEqual(settings.googleCalendarSelection(), { calendarId: 'agenda@group.calendar.google.com', summary: 'Agenda pro' });
});

test('no connection reads as disconnected, with an empty token', () => {
  const { settings } = makeSettings();
  assert.equal(settings.googleConnected(), false);
  assert.equal(settings.googleTokens().refreshToken, '');
});

test('recordGoogleSyncResult keeps the tri-state and clearGoogleConnection resets everything', () => {
  const { settings } = makeSettings();
  assert.equal(settings.googleStatus().lastSyncOk, null);

  settings.storeGoogleTokens({ refreshToken: REFRESH_TOKEN, email: 'adrien@example.com' });
  settings.storeGoogleCalendarSelection({ calendarId: 'cal-1', summary: 'Agenda pro' });
  settings.recordGoogleSyncResult({ ok: false, detail: '1 erreur' });
  let s = settings.googleStatus();
  assert.equal(s.lastSyncOk, false);
  assert.equal(s.lastSyncDetail, '1 erreur');
  assert.ok(s.lastSyncAt);

  settings.recordGoogleSyncResult({ ok: true, detail: '3 envoyée(s)' });
  assert.equal(settings.googleStatus().lastSyncOk, true);

  settings.clearGoogleConnection();
  s = settings.googleStatus();
  assert.equal(s.connected, false);
  assert.equal(s.connectedEmail, '');
  assert.equal(s.calendarId, '');
  assert.equal(s.calendarSummary, '');
  assert.equal(s.lastSyncAt, null);
  assert.equal(s.lastSyncOk, null);
  assert.equal(s.lastSyncDetail, '');
});
