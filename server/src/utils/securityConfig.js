/**
 * Pure builders for the security-related Express middleware config: Helmet options + session
 * cookie options. Extracted from index.js so the policies are unit-testable and so the rules
 * that decide whether to enforce HTTPS are written down in one place.
 *
 * ## Why this exists (the bug it prevents)
 *
 * Helmet's default CSP includes `upgrade-insecure-requests` and, when enabled, HSTS pins the
 * host to HTTPS. Both tell the browser "every HTTP URL on this host must be upgraded to HTTPS"
 * — fine when the public edge actually serves HTTPS, fatal when it serves plain HTTP (every
 * static asset request fails the TLS handshake → "Une erreur TLS a provoqué l'échec de la
 * connexion sécurisée"). The original index.js gated this on `NODE_ENV === 'production'` which
 * conflated "this is a production build" with "TLS is available at the network edge". On a
 * Raspberry Pi served over plain HTTP, the assumption broke and the SPA wouldn't load.
 *
 * The fix decouples the two concerns via a dedicated `HTTPS_EDGE` env var:
 *   - `NODE_ENV=production`  → run as prod (CSP enabled, error formatting, etc.)
 *   - `HTTPS_EDGE=true`      → an HTTPS edge (the Caddy reverse proxy) sits in front of the app,
 *                              so HSTS + CSP upgrade + secure cookies are safe to enforce even
 *                              though the app itself only serves plain HTTP internally.
 * Both must be set together to lock the app to HTTPS; either alone is a misconfiguration the
 * tests below pin down.
 *
 * NOTE: `HTTPS_EDGE` is NOT about the app terminating TLS (it never does anymore — Caddy owns
 * that, see specs/reverse-proxy-caddy.md). It only declares "an HTTPS edge is in front of me",
 * which is what makes the security headers + Secure cookie correct.
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
 * Returns true when an HTTPS edge sits in front of the app, so the app should emit the
 * HTTPS-only security posture (HSTS + upgrade-insecure-requests + Secure cookie). Independent of
 * `NODE_ENV` on purpose — it's about the network edge, not the build mode.
 */
function shouldEnforceHttps(env = process.env) {
  return envFlag(env.HTTPS_EDGE);
}

/**
 * Helmet options. Production keeps the SPA-tuned CSP; HTTPS enforcement (HSTS + the implicit
 * upgrade-insecure-requests inside the default directives) is gated on `HTTPS_EDGE` so a
 * plain-HTTP prod deployment (no proxy yet) stays usable.
 *
 * @param {object} options
 * @param {boolean} options.isProduction
 * @param {boolean} options.httpsEdge — an HTTPS edge (Caddy) serves the public connection
 * @returns {object} options accepted by `helmet()`
 */
function buildHelmetOptions({ isProduction, httpsEdge }) {
  return {
    contentSecurityPolicy: isProduction
      ? {
          // `useDefaults: false` so we are explicit about every directive. Helmet's default CSP
          // includes `upgrade-insecure-requests`, which is exactly what we are trying NOT to
          // emit when HTTPS_EDGE is false. Listing the directives ourselves makes it
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
            ...(httpsEdge ? { upgradeInsecureRequests: [] } : {}),
          },
        }
      : false,
    // HSTS — only when an HTTPS edge is actually in front. Defaults are sensible (1 year, include
    // subdomains, preload-ready) so we pass `true` and let helmet apply them.
    strictTransportSecurity: httpsEdge,
    crossOriginEmbedderPolicy: false,
    // Allow the dev client (:3000) to load /uploads from :4000.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/**
 * Session cookie options. The cookie is marked Secure only when an HTTPS edge is in front of the
 * app — over plain HTTP a Secure cookie is silently dropped by browsers, which would make every
 * login round-trip fail without an obvious error. Behind Caddy the browser↔edge connection is
 * HTTPS, so the Secure cookie is set and sent correctly even though Caddy→app is plain HTTP.
 *
 * @param {object} options
 * @param {boolean} options.httpsEdge
 * @returns {object} the `cookie` block to nest under `session()` options
 */
function buildSessionCookieOptions({ httpsEdge }) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: httpsEdge,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

/**
 * Permissions-Policy header — instructs the browser to deny powerful APIs that the app
 * doesn't use. Defense-in-depth against future XSS or an embedded iframe trying to access
 * camera/mic/geoloc/payment. The empty `=()` syntax denies the feature to every origin
 * (including self). Spotted in the 2026-06-01 security audit (finding L1).
 *
 * Helmet 7 doesn't ship a built-in middleware for this header (it was previously
 * `Feature-Policy`, renamed and re-spec'd), so we set it ourselves alongside the helmet
 * middleware in index.js.
 */
const PERMISSIONS_POLICY_VALUE = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'fullscreen=(self)', // allow only self, in case a future modal uses it
].join(', ');

module.exports = {
  envFlag,
  shouldEnforceHttps,
  buildHelmetOptions,
  buildSessionCookieOptions,
  PERMISSIONS_POLICY_VALUE,
};
