/**
 * Google Calendar connection-test helper + French error mapping
 * (specs/google-calendar-oauth-rework.md §3 rule 25 / §4.3 test-connection).
 *
 * The service-account JWT machinery that used to live here was removed by the OAuth
 * rework — authentication now goes through utils/googleOAuthClient. The caller supplies
 * the authenticated `calendarApi`, which keeps this module free of `googleapis` and
 * fully unit-testable.
 *
 * Exports:
 *   mapGoogleError(error)                  → { code, error } with a French message
 *   testConnection(config, { calendarApi }) → { ok, message? } | { ok:false, code, error }
 */

function mapGoogleError(error) {
  const status = Number((error && error.response && error.response.status) || (error && error.code) || 500);
  if (status === 401 || status === 400) {
    return {
      code: 'INVALID_CREDENTIALS',
      error: 'Connexion Google expirée ou révoquée. Reconnectez votre compte.',
    };
  }
  if (status === 403) {
    return {
      code: 'FORBIDDEN',
      error: "Votre compte Google n'a pas la permission d'écrire dans cet agenda.",
    };
  }
  if (status === 404) {
    return {
      code: 'CALENDAR_NOT_FOUND',
      error: "Agenda introuvable. Choisissez un autre agenda cible.",
    };
  }
  const message = (error && error.response && error.response.data && error.response.data.error && error.response.data.error.message)
    || (error && error.message)
    || 'Erreur Google inconnue';
  return { code: 'UNKNOWN', error: `Erreur Google : ${message}` };
}

async function testConnection(config, { calendarApi } = {}) {
  if (!config || !config.configured || !config.calendarId) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: "Connectez votre compte Google et choisissez un agenda avant de tester.",
    };
  }

  if (!calendarApi) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: "Connexion Google absente. Reconnectez votre compte.",
    };
  }

  try {
    const result = await calendarApi.calendars.get({ calendarId: config.calendarId });
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
  mapGoogleError,
  testConnection,
};

module.exports.__test = {
  mapGoogleError,
  testConnection,
};
