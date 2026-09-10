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
    // `__Host-` requires Path=/ (express-session's default) and no Domain attribute, so it must be
    // set explicitly alongside the name below.
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

/**
 * The session cookie's NAME (specs/guest-gate-access.md §9).
 *
 * Under HTTPS it carries the **`__Host-` prefix**, which browsers only accept from a cookie that is
 * Secure, Path=/ and has no Domain — and, the point here, they refuse it from ANY other host of the
 * domain. The guest page lives at `guest.domainesolio.com`, a sibling of the admin app under the
 * same registrable domain: a script running there could otherwise set a `.domainesolio.com` cookie
 * of the same name and shadow the operator's session (cookie tossing). The prefix closes that door
 * at the browser, which is the only place it can be closed.
 *
 * Over plain HTTP the prefix is illegal and the cookie would simply be dropped, so the bare name is
 * used — in development, where the guard cannot matter anyway.
 *
 * Deploying this logs the operator out once: the browser holds the old name, the server now looks
 * for the new one. That is the whole cost.
 */
function sessionCookieName({ httpsEnabled }) {
  return httpsEnabled ? '__Host-guestflow.sid' : 'guestflow.sid';
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
  sessionCookieName,
  PERMISSIONS_POLICY_VALUE,
};
