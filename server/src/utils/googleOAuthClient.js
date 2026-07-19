/**
 * Google OAuth client helpers — authorization-code flow with refresh token
 * (specs/google-calendar-oauth-rework.md §3 rules 1-8).
 *
 * `googleapis` is required lazily inside the functions that build real clients so unit
 * tests (which inject a fake `OAuth2` constructor or a fake calendar API) never load it.
 *
 * Exports:
 *   buildGoogleOAuthClient({ env, settings, OAuth2, fetchImpl }) → factory (fully injectable)
 *   emailFromIdToken(idToken)   → pure: email claim from a Google id_token
 *   isInvalidGrant(error)       → true when Google reports a revoked/expired refresh token
 *   CALLBACK_PATH               → '/api/google-calendar/oauth/callback'
 */

const settingsModel = require('../models/settingsModel');

const CALLBACK_PATH = '/api/google-calendar/oauth/callback';

// calendar.events = event CRUD on calendars the user can write to; calendar.readonly = list
// the user's calendars for the picker; openid+email = identify the connected account.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
];

// No signature check — the id_token comes straight from Google's token endpoint over TLS.
function emailFromIdToken(idToken) {
  try {
    const payload = String(idToken || '').split('.')[1];
    if (!payload) return '';
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return String(json.email || '').trim();
  } catch {
    return '';
  }
}

// Google signals a revoked/expired refresh token as `invalid_grant` (spec rule 8).
function isInvalidGrant(error) {
  const dataError = error && error.response && error.response.data && error.response.data.error;
  if (String(dataError || '') === 'invalid_grant') return true;
  return /invalid_grant/i.test(String((error && error.message) || ''));
}

function buildGoogleOAuthClient({
  env = process.env,
  settings = settingsModel,
  OAuth2 = null,
  fetchImpl = null,
} = {}) {
  const clientId = () => String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = () => String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();

  function isConfigured() {
    return Boolean(clientId() && clientSecret());
  }

  // Env override first, else the configured public URL + callback path (Qonto precedent).
  // Empty string when neither is available — the controller turns that into a 400.
  function resolveRedirectUri() {
    const override = String(env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
    if (override) return override;
    const publicUrl = settings.publicUrl();
    if (!publicUrl) return '';
    return publicUrl.replace(/\/+$/, '') + CALLBACK_PATH;
  }

  function makeOAuth2() {
    // eslint-disable-next-line global-require
    const Ctor = OAuth2 || require('googleapis').google.auth.OAuth2;
    return new Ctor(clientId(), clientSecret(), resolveRedirectUri());
  }

  return {
    isConfigured,
    resolveRedirectUri,

    // `consent` + `access_type: 'offline'` guarantee a refresh token on every connect
    // (Google only issues one on first consent otherwise). `select_account` forces the
    // account picker: without it Google silently uses the browser's active session, which
    // on a multi-account browser connects the WRONG account (an Internal-app rejection at
    // best) — hit during the 2026-07-19 production setup.
    getAuthorizeUrl({ state }) {
      return makeOAuth2().generateAuthUrl({
        access_type: 'offline',
        prompt: 'select_account consent',
        scope: SCOPES,
        state,
      });
    },

    async exchangeCode({ code }) {
      const { tokens } = await makeOAuth2().getToken(code);
      return {
        refreshToken: String((tokens && tokens.refresh_token) || ''),
        email: emailFromIdToken(tokens && tokens.id_token),
      };
    },

    // Best-effort revocation — never throws (spec rule 7): a failed revoke must not block
    // the disconnect, the token is cleared from the DB either way.
    async revokeToken(token) {
      if (!token) return;
      try {
        const doFetch = fetchImpl || globalThis.fetch;
        await doFetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        });
      } catch (err) {
        console.error('[googleOAuthClient.revokeToken]', (err && err.message) || err);
      }
    },

    // Authenticated calendar client from the stored refresh token, or null when not
    // connected. googleapis mints/refreshes access tokens in memory — nothing persisted.
    getAuthedCalendar() {
      const { refreshToken } = settings.googleTokens();
      if (!refreshToken) return null;
      // eslint-disable-next-line global-require
      const { google } = require('googleapis');
      const auth = makeOAuth2();
      auth.setCredentials({ refresh_token: refreshToken });
      return google.calendar({ version: 'v3', auth });
    },
  };
}

module.exports = {
  buildGoogleOAuthClient,
  emailFromIdToken,
  isInvalidGrant,
  CALLBACK_PATH,
  SCOPES,
};
