/**
 * Qonto token manager (specs/online-payments-qonto.md §4.1).
 *
 * Returns a valid OAuth access token for API calls: reuses the stored access token while it's still
 * fresh, otherwise refreshes it via the refresh token and persists the new pair. The OAuth tokens
 * live encrypted in app_settings (settingsModel); the client id/secret live in .env.local and are
 * read by `qontoClient`.
 *
 * Pure + injectable: pass `settings` (settingsModel-shaped), `clientFactory` (→ qontoClient) and
 * `now` so it is fully unit-testable without network or wall-clock.
 */

const { buildQontoClient } = require('./qontoClient');

// Refresh a little before the real expiry so an in-flight call never races the boundary.
const REFRESH_SKEW_MS = 60 * 1000;

// The refresh running for each refresh token (specs/qonto-settings-in-app.md rule 18). A provider may treat a
// second use of a rotated token as theft and revoke the whole family, so concurrent callers share one call.
const refreshesInFlight = new Map();

const notConnected = () => {
  const err = new Error('Qonto is not connected (no refresh token stored)');
  err.code = 'QONTO_NOT_CONNECTED';
  return err;
};

async function refreshAndStore({ settings, clientFactory, refreshToken, now }) {
  const client = clientFactory();
  const refreshed = await client.refresh({ refreshToken }).catch((error) => {
    if (settings.qontoTokens().refreshToken === refreshToken) throw error;
    return null;
  });
  // Rule 19: new credentials or a new consent landed meanwhile; the answer, or the failure, belongs to the tokens they replaced.
  const current = settings.qontoTokens();
  if (current.refreshToken !== refreshToken) {
    if (current.accessToken) return current.accessToken;
    throw Object.assign(notConnected(), { overtaken: true });
  }
  const newExpiresAt = refreshed.expiresIn ? new Date(now + refreshed.expiresIn * 1000).toISOString() : null;
  settings.storeQontoTokens({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: newExpiresAt,
  });
  return refreshed.accessToken;
}

async function getValidQontoAccessToken({ settings, clientFactory = buildQontoClient, now = Date.now() } = {}) {
  const tokens = settings.qontoTokens();
  if (!tokens.refreshToken) throw notConnected();

  const expiresMs = tokens.expiresAt ? Date.parse(tokens.expiresAt) : NaN;
  const stillFresh = Boolean(tokens.accessToken) && Number.isFinite(expiresMs) && (expiresMs - now > REFRESH_SKEW_MS);
  if (stillFresh) return tokens.accessToken;

  // Expired / unknown expiry / no access token → refresh and persist.
  const { refreshToken } = tokens;
  const inFlight = refreshesInFlight.get(refreshToken);
  if (inFlight) return inFlight;
  // The entry leaves only once the new pair is stored: a caller arriving later reads the new tokens, never the old.
  const refresh = refreshAndStore({ settings, clientFactory, refreshToken, now })
    .finally(() => refreshesInFlight.delete(refreshToken));
  refreshesInFlight.set(refreshToken, refresh);
  return refresh;
}

module.exports = { getValidQontoAccessToken, REFRESH_SKEW_MS };
