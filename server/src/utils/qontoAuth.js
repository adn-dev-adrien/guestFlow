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

async function getValidQontoAccessToken({ settings, clientFactory = buildQontoClient, now = Date.now() } = {}) {
  const tokens = settings.qontoTokens();
  if (!tokens.refreshToken) {
    const err = new Error('Qonto is not connected (no refresh token stored)');
    err.code = 'QONTO_NOT_CONNECTED';
    throw err;
  }

  const expiresMs = tokens.expiresAt ? Date.parse(tokens.expiresAt) : NaN;
  const stillFresh = Boolean(tokens.accessToken) && Number.isFinite(expiresMs) && (expiresMs - now > REFRESH_SKEW_MS);
  if (stillFresh) return tokens.accessToken;

  // Expired / unknown expiry / no access token → refresh and persist.
  const client = clientFactory();
  const refreshed = await client.refresh({ refreshToken: tokens.refreshToken });
  const newExpiresAt = refreshed.expiresIn ? new Date(now + refreshed.expiresIn * 1000).toISOString() : null;
  settings.storeQontoTokens({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: newExpiresAt,
  });
  return refreshed.accessToken;
}

module.exports = { getValidQontoAccessToken, REFRESH_SKEW_MS };
