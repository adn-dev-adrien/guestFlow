const test = require('node:test');
const assert = require('node:assert/strict');

const googleCalendarClient = require('../utils/googleCalendarClient');
const { testConnection } = googleCalendarClient;
const { mapGoogleError } = googleCalendarClient.__test;

// OAuth rework (specs/google-calendar-oauth-rework.md): config is now just the selected
// calendar + a configured flag; the caller supplies the authenticated calendarApi.
const VALID_CONFIG = {
  calendarId: 'mon-agenda@group.calendar.google.com',
  configured: true,
};

function makeCalendarApi({ ok, error } = {}) {
  return {
    calendars: {
      get: async () => {
        if (error) throw error;
        return { data: { summary: ok || 'Agenda fictif' } };
      },
    },
  };
}

// --- mapGoogleError ---
test('mapGoogleError: 401 → INVALID_CREDENTIALS (expired/revoked connection)', () => {
  const out = mapGoogleError({ response: { status: 401 } });
  assert.equal(out.code, 'INVALID_CREDENTIALS');
  assert.match(out.error, /expirée|révoquée/);
});
test('mapGoogleError: 400 → INVALID_CREDENTIALS', () => {
  assert.equal(mapGoogleError({ response: { status: 400 } }).code, 'INVALID_CREDENTIALS');
});
test('mapGoogleError: 403 → FORBIDDEN', () => {
  const out = mapGoogleError({ response: { status: 403 } });
  assert.equal(out.code, 'FORBIDDEN');
  assert.match(out.error, /permission/);
});
test('mapGoogleError: 403 accessNotConfigured → API_DISABLED naming the Cloud project', () => {
  // Real shape returned by googleapis when the Calendar API is disabled in the project
  // that owns the OAuth client (2026-07-21 production setup).
  const out = mapGoogleError({
    response: {
      status: 403,
      data: {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Google Calendar API has not been used in project 368709445905 before or it is disabled. '
            + 'Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=368709445905 then retry.',
          errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits' }],
        },
      },
    },
  });
  assert.equal(out.code, 'API_DISABLED');
  assert.match(out.error, /n'est pas activée/);
  assert.match(out.error, /368709445905/);
  assert.match(out.error, /Bibliothèque/);
});
test('mapGoogleError: 403 API-disabled detected from the message alone (no errors array)', () => {
  const out = mapGoogleError({
    code: 403,
    message: 'Calendar API has not been used in project 12345 before or it is disabled.',
  });
  assert.equal(out.code, 'API_DISABLED');
  assert.match(out.error, /12345/);
});
test('mapGoogleError: 404 → CALENDAR_NOT_FOUND', () => {
  const out = mapGoogleError({ response: { status: 404 } });
  assert.equal(out.code, 'CALENDAR_NOT_FOUND');
  assert.match(out.error, /introuvable/);
});
test('mapGoogleError: 500 + nested message → UNKNOWN with message', () => {
  const out = mapGoogleError({
    response: { status: 500, data: { error: { message: 'Backend unavailable' } } },
  });
  assert.equal(out.code, 'UNKNOWN');
  assert.match(out.error, /Backend unavailable/);
});

// --- testConnection ---
test('testConnection: NOT_CONFIGURED on missing config / calendar', async () => {
  assert.equal((await testConnection(null)).code, 'NOT_CONFIGURED');
  assert.equal((await testConnection({ configured: false })).code, 'NOT_CONFIGURED');
  assert.equal((await testConnection({ configured: true, calendarId: '' })).code, 'NOT_CONFIGURED');
});

test('testConnection: NOT_CONFIGURED when no calendarApi is supplied (no connection)', async () => {
  const out = await testConnection(VALID_CONFIG, {});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'NOT_CONFIGURED');
  assert.match(out.error, /Reconnectez/);
});

test('testConnection: ok on successful Google response', async () => {
  const calendarApi = makeCalendarApi({ ok: 'Réservations partagées' });
  const out = await testConnection(VALID_CONFIG, { calendarApi });
  assert.equal(out.ok, true);
  assert.match(out.message, /Connexion réussie/);
  assert.match(out.message, /Réservations partagées/);
});

test('testConnection: maps 404 → CALENDAR_NOT_FOUND', async () => {
  const calendarApi = makeCalendarApi({ error: { response: { status: 404 } } });
  const out = await testConnection(VALID_CONFIG, { calendarApi });
  assert.equal(out.code, 'CALENDAR_NOT_FOUND');
});
test('testConnection: maps 401 → INVALID_CREDENTIALS', async () => {
  const calendarApi = makeCalendarApi({ error: { response: { status: 401 } } });
  assert.equal((await testConnection(VALID_CONFIG, { calendarApi })).code, 'INVALID_CREDENTIALS');
});
test('testConnection: maps 403 → FORBIDDEN', async () => {
  const calendarApi = makeCalendarApi({ error: { response: { status: 403 } } });
  assert.equal((await testConnection(VALID_CONFIG, { calendarApi })).code, 'FORBIDDEN');
});
test('testConnection: maps 503 → UNKNOWN', async () => {
  const calendarApi = makeCalendarApi({
    error: { response: { status: 503, data: { error: { message: 'busy' } } } },
  });
  const out = await testConnection(VALID_CONFIG, { calendarApi });
  assert.equal(out.code, 'UNKNOWN');
  assert.match(out.error, /busy/);
});
