const test = require('node:test');
const assert = require('node:assert/strict');

const googleCalendarClient = require('../utils/googleCalendarClient');
const { testConnection } = googleCalendarClient;
const { mapGoogleError } = googleCalendarClient.__test;

const VALID_CONFIG = {
  calendarId: 'mon-agenda@gmail.com',
  clientEmail: 'robot@projet.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
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
test('mapGoogleError: 401 → INVALID_CREDENTIALS', () => {
  const out = mapGoogleError({ response: { status: 401 } });
  assert.equal(out.code, 'INVALID_CREDENTIALS');
  assert.match(out.error, /invalide/);
});
test('mapGoogleError: 400 → INVALID_CREDENTIALS', () => {
  assert.equal(mapGoogleError({ response: { status: 400 } }).code, 'INVALID_CREDENTIALS');
});
test('mapGoogleError: 403 → FORBIDDEN', () => {
  const out = mapGoogleError({ response: { status: 403 } });
  assert.equal(out.code, 'FORBIDDEN');
  assert.match(out.error, /permission/);
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
test('testConnection: NOT_CONFIGURED on missing config', async () => {
  assert.equal((await testConnection(null)).code, 'NOT_CONFIGURED');
  assert.equal((await testConnection({ configured: false })).code, 'NOT_CONFIGURED');
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

test('testConnection: returns UNKNOWN (no crash) when googleapis cannot be required', async () => {
  // No calendarApi injected → testConnection will try to require('googleapis').
  // If it's not installed, our try/catch returns UNKNOWN instead of throwing.
  const out = await testConnection(VALID_CONFIG);
  // We can't deterministically assert ok=false here (depends on whether the user
  // has googleapis installed). We just assert no throw + proper shape.
  assert.equal(typeof out.ok, 'boolean');
  if (!out.ok) {
    assert.ok(['UNKNOWN', 'INVALID_CREDENTIALS', 'CALENDAR_NOT_FOUND', 'FORBIDDEN'].includes(out.code));
    assert.equal(typeof out.error, 'string');
  }
});
