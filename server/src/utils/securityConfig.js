/**
 * Pure builders for the security-related Express middleware config: Helmet options + session
 * cookie options. Extracted from index.js so the policies are unit-testable and so the rules
 * that decide whether to enforce HTTPS are written down in one place.
 *
 * ## Why this exists (the bug it prevents)
 *
 * Helmet's default CSP includes `upgrade-insecure-requests` and, when enabled, HSTS pins the
 * host to HTTPS. Both tell the browser "every HTTP URL on this host must be upgraded to HTTPS"
 * — fine when the prod stack actually serves HTTPS, fatal when it serves plain HTTP (every
 * static asset request fails the TLS handshake → "Une erreur TLS a provoqué l'échec de la
 * connexion sécurisée"). The original index.js gated this on `NODE_ENV === 'production'` which
 * conflated "this is a production build" with "TLS is available at the network edge". On a
 * Raspberry Pi served over plain HTTP, the assumption broke and the SPA wouldn't load.
 *
 * The fix decouples the two concerns via a dedicated `HTTPS_ENABLED` env var:
 *   - `NODE_ENV=production`  → run as prod (CSP enabled, error formatting, etc.)
 *   - `HTTPS_ENABLED=true`   → the network edge actually serves HTTPS, so HSTS + CSP upgrade
 *                              + secure cookies are safe to enforce.
 * Both must be set together to lock the app to HTTPS; either alone is a misconfiguration the
 * tests below pin down.
 *
 * Also keep in mind: HSTS is sticky on the browser side. Once issued, the browser refuses
 * plain HTTP for the host until `max-age` expires (or the user clears it manually). The README
 * documents how to clear it in Safari / Chrome / Firefox.
 */

/**
 * Reads booleans from env (only `'true'` enables; anything else, incl. unset, disables).
 * Trims to be tolerant of CI / PM2 env files that drop trailing whitespace differently.
 */
function envFlag(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

/**
 * Returns true when the app should enforce HTTPS at the browser boundary. Independent of
 * `NODE_ENV` on purpose — it's about the network edge, not the build mode.
 */
function shouldEnforceHttps(env = process.env) {
  return envFlag(env.HTTPS_ENABLED);
}

/**
 * Helmet options. Production keeps the SPA-tuned CSP; HTTPS enforcement (HSTS + the implicit
 * upgrade-insecure-requests inside the default directives) is gated on `HTTPS_ENABLED` so a
 * plain-HTTP prod deployment stays usable.
 *
 * @param {object} options
 * @param {boolean} options.isProduction
 * @param {boolean} options.httpsEnabled
 * @returns {object} options accepted by `helmet()`
 */
function buildHelmetOptions({ isProduction, httpsEnabled }) {
  return {
    contentSecurityPolicy: isProduction
      ? {
          // `useDefaults: false` so we are explicit about every directive. Helmet's default CSP
          // includes `upgrade-insecure-requests`, which is exactly what we are trying NOT to
          // emit when HTTPS_ENABLED is false. Listing the directives ourselves makes it
          // impossible for a future Helmet release to silently turn the upgrade back on.
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            ...(httpsEnabled ? { upgradeInsecureRequests: [] } : {}),
          },
        }
      : false,
    // HSTS — only when TLS is actually available. Defaults are sensible (1 year, include
    // subdomains, preload-ready) so we pass `true` and let helmet apply them.
    strictTransportSecurity: httpsEnabled,
    crossOriginEmbedderPolicy: false,
    // Allow the dev client (:3000) to load /uploads from :4000.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/**
 * Session cookie options. The cookie is marked Secure only when HTTPS is actually available
 * at the network edge — over plain HTTP a Secure cookie is silently dropped by browsers,
 * which would make every login round-trip fail without an obvious error.
 *
 * @param {object} options
 * @param {boolean} options.httpsEnabled
 * @returns {object} the `cookie` block to nest under `session()` options
 */
function buildSessionCookieOptions({ httpsEnabled }) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: httpsEnabled,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

module.exports = {
  envFlag,
  shouldEnforceHttps,
  buildHelmetOptions,
  buildSessionCookieOptions,
};
