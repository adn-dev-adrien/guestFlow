/**
 * Google Calendar client helpers — extracted from routes/googleCalendar.js so they
 * can be reused by both the legacy sync routes and the new test-connection action.
 *
 * `googleapis` is required lazily inside getGoogleCalendarClient so unit tests
 * (which inject a fake `calendarApi`) and the rest of the app don't break when
 * the dependency isn't installed.
 *
 * Exports:
 *   sanitizePrivateKey(value)            → string with escaped \n turned into real newlines
 *   getGoogleCalendarConfig(overrides?)  → { calendarId, clientEmail, privateKey, configured }
 *   getGoogleCalendarClient(config)      → authenticated googleapis calendar client
 *   testConnection(config, opts?)        → { ok, message? } | { ok:false, code, error }
 */

const settingsModel = require('../models/settingsModel');

function sanitizePrivateKey(privateKey) {
  return String(privateKey || '').replace(/\\n/g, '\n').trim();
}

function getGoogleCalendarConfig(overrides = {}) {
  const settings = settingsModel.read();

  const calendarId = String(
    overrides.calendarId
    || settings.googleCalendarId
    || process.env.GOOGLE_CALENDAR_ID
    || ''
  ).trim();

  const clientEmail = String(
    overrides.clientEmail
    || settings.googleServiceAccountEmail
    || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    || ''
  ).trim();

  const privateKey = sanitizePrivateKey(
    overrides.privateKey
    || settings.googleServiceAccountPrivateKey
    || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    || ''
  );

  return {
    calendarId,
    clientEmail,
    privateKey,
    configured: Boolean(calendarId && clientEmail && privateKey),
  };
}

function getGoogleCalendarClient(config) {
  // eslint-disable-next-line global-require
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

function mapGoogleError(error) {
  const status = Number((error && error.response && error.response.status) || (error && error.code) || 500);
  if (status === 401 || status === 400) {
    return {
      code: 'INVALID_CREDENTIALS',
      error: 'Email du compte technique invalide ou clé non reconnue.',
    };
  }
  if (status === 403) {
    return {
      code: 'FORBIDDEN',
      error: "Le compte technique n'a pas la permission d'accéder à cet agenda. Partagez l'agenda avec lui depuis Google Agenda.",
    };
  }
  if (status === 404) {
    return {
      code: 'CALENDAR_NOT_FOUND',
      error: "Agenda introuvable. Vérifiez l'identifiant.",
    };
  }
  const message = (error && error.response && error.response.data && error.response.data.error && error.response.data.error.message)
    || (error && error.message)
    || 'Erreur Google inconnue';
  return { code: 'UNKNOWN', error: `Erreur Google : ${message}` };
}

async function testConnection(config, { calendarApi } = {}) {
  if (!config || !config.configured) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: "Configurez d'abord les identifiants avant de tester.",
    };
  }

  let calendar;
  try {
    calendar = calendarApi || getGoogleCalendarClient(config);
  } catch (initError) {
    return {
      ok: false,
      code: 'UNKNOWN',
      error: `Erreur d'initialisation Google : ${initError.message}`,
    };
  }

  try {
    const result = await calendar.calendars.get({ calendarId: config.calendarId });
    const summary = String(
      (result && result.data && result.data.summary)
      || (result && result.summary)
      || 'Agenda'
    );
    return {
      ok: true,
      message: `Connexion réussie. Agenda « ${summary} » accessible.`,
    };
  } catch (error) {
    return { ok: false, ...mapGoogleError(error) };
  }
}

module.exports = {
  sanitizePrivateKey,
  getGoogleCalendarConfig,
  getGoogleCalendarClient,
  testConnection,
};

module.exports.__test = {
  mapGoogleError,
  testConnection,
};
