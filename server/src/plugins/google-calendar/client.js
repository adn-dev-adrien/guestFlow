/**
 * Google Calendar connection-test helper + French error mapping
 * (specs/google-calendar-oauth-rework.md §3 rule 25 / §4.3 test-connection).
 *
 * The service-account JWT machinery that used to live here was removed by the OAuth
 * rework — authentication now goes through oauthClient.js. The caller supplies
 * the authenticated `calendarApi`, which keeps this module free of `googleapis` and
 * fully unit-testable.
 *
 * Exports:
 *   mapGoogleError(error)                  → { code, error } with a French message
 *   googleErrorForLog(error)               → what a log line may print of a Google failure
 *   testConnection(config, { calendarApi }) → { ok, message? } | { ok:false, code, error }
 */

function mapGoogleError(error) {
  const status = Number((error && error.response && error.response.status) || (error && error.code) || 500);
  if (status === 401 || status === 400) {
    return {
      code: 'INVALID_CREDENTIALS',
      error: 'Connexion Google expirée ou révoquée. Compte à reconnecter.',
    };
  }
  if (status === 403) {
    // "Calendar API not enabled in this Cloud project" is also a 403 — the generic
    // write-permission message below would point the user at calendar sharing instead
    // of the API library (cost a debugging detour during the 2026-07-21 prod setup).
    const data = (error && error.response && error.response.data && error.response.data.error) || {};
    const reasons = []
      .concat(Array.isArray(data.errors) ? data.errors : [], Array.isArray(error && error.errors) ? error.errors : [])
      .map((e) => String((e && e.reason) || ''));
    const rawMessage = String(data.message || (error && error.message) || '');
    if (reasons.includes('accessNotConfigured') || /has not been used in project|it is disabled/i.test(rawMessage)) {
      const project = (rawMessage.match(/project\s+(\d+)/) || [])[1];
      return {
        code: 'API_DISABLED',
        error: `L'API Google Calendar n'est pas activée dans le projet Google Cloud${project ? ` n° ${project}` : ''}. `
          + 'À activer dans la console Google (API et services → Bibliothèque → Google Calendar API), '
          + 'puis nouvel essai après quelques minutes.',
      };
    }
    return {
      code: 'FORBIDDEN',
      error: "Votre compte Google n'a pas la permission d'écrire dans cet agenda.",
    };
  }
  if (status === 404) {
    return {
      code: 'CALENDAR_NOT_FOUND',
      error: "Agenda introuvable. Autre agenda cible à choisir.",
    };
  }
  const message = (error && error.response && error.response.data && error.response.data.error && error.response.data.error.message)
    || (error && error.message)
    || 'Erreur Google inconnue';
  return { code: 'UNKNOWN', error: `Erreur Google : ${message}` };
}

// A GaxiosError carries its request in `config`: on the token call that is the refresh token, which
// gaxios's redactor does not mask (specs/google-calendar-oauth-rework.md rule 5, reading of 2026-11-04).
function googleErrorForLog(error) {
  return error?.response?.data || { message: error?.message, code: error?.code, status: error?.status };
}

async function testConnection(config, { calendarApi } = {}) {
  if (!config || !config.configured || !config.calendarId) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: "Compte Google à connecter et agenda à choisir avant de tester.",
    };
  }

  if (!calendarApi) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: "Connexion Google absente. Compte à reconnecter.",
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
  googleErrorForLog,
  testConnection,
};

module.exports.__test = {
  mapGoogleError,
  testConnection,
};
