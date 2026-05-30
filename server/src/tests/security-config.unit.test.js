const test = require('node:test');
const assert = require('node:assert/strict');

const {
  envFlag,
  shouldEnforceHttps,
  buildHelmetOptions,
  buildSessionCookieOptions,
} = require('../utils/securityConfig');

// These tests pin the rules that prevent the prod-without-TLS regression
// (HSTS + CSP `upgrade-insecure-requests` were unconditionally enforced on
// `NODE_ENV=production`, breaking deploys that serve plain HTTP). The full rule table:
//
//   | NODE_ENV    | HTTPS_ENABLED | CSP        | HSTS  | upgrade-insecure-requests | secure cookie |
//   |-------------|---------------|------------|-------|---------------------------|---------------|
//   | development | (any)         | OFF        | OFF   | n/a                       | OFF           |
//   | production  | (unset/false) | ON (SPA)   | OFF   | OFF                       | OFF           |
//   | production  | true          | ON (SPA)   | ON    | ON                        | ON            |
//
// Changing the rules MUST update both the table above and the cases below.

// ----- envFlag / shouldEnforceHttps -----

test('envFlag: only the literal "true" (case-insensitive, trimmed) enables', () => {
  assert.equal(envFlag('true'), true);
  assert.equal(envFlag('TRUE'), true);
  assert.equal(envFlag('  true '), true);
  for (const v of ['false', '1', '0', 'yes', 'on', '', undefined, null]) {
    assert.equal(envFlag(v), false, `envFlag(${JSON.stringify(v)})`);
  }
});

test('shouldEnforceHttps: defaults to false (HTTPS_ENABLED missing means no HTTPS guarantee)', () => {
  assert.equal(shouldEnforceHttps({}), false);
  assert.equal(shouldEnforceHttps({ HTTPS_ENABLED: 'false' }), false);
  assert.equal(shouldEnforceHttps({ HTTPS_ENABLED: '1' }), false);
  // NODE_ENV does NOT influence it on purpose — production deploy without TLS stays usable.
  assert.equal(shouldEnforceHttps({ NODE_ENV: 'production' }), false);
});

test('shouldEnforceHttps: true only when HTTPS_ENABLED is the literal "true"', () => {
  assert.equal(shouldEnforceHttps({ HTTPS_ENABLED: 'true' }), true);
  assert.equal(shouldEnforceHttps({ HTTPS_ENABLED: 'TRUE' }), true);
});

// ----- buildHelmetOptions -----

test('helmet: development → CSP off, HSTS off (allow plain-HTTP dev session)', () => {
  const opts = buildHelmetOptions({ isProduction: false, httpsEnabled: false });
  assert.equal(opts.contentSecurityPolicy, false);
  assert.equal(opts.strictTransportSecurity, false);
});

test('helmet: production + HTTPS_ENABLED=false → CSP on (SPA-tuned), HSTS OFF, no upgrade-insecure-requests', () => {
  const opts = buildHelmetOptions({ isProduction: true, httpsEnabled: false });
  assert.equal(opts.strictTransportSecurity, false, 'HSTS off so plain HTTP still works');
  const csp = opts.contentSecurityPolicy;
  assert.ok(csp, 'CSP is set');
  assert.equal(csp.useDefaults, false, 'useDefaults must be false — Helmet defaults include upgrade-insecure-requests');
  assert.equal('upgradeInsecureRequests' in csp.directives, false, 'no upgrade-insecure-requests when HTTPS not enforced');
  // Sanity: the actual SPA-tuned directives are still there.
  assert.deepEqual(csp.directives.defaultSrc, ["'self'"]);
  assert.deepEqual(csp.directives.scriptSrc, ["'self'"]);
  assert.deepEqual(csp.directives.frameAncestors, ["'none'"]);
});

test('helmet: production + HTTPS_ENABLED=true → CSP on, HSTS on, upgrade-insecure-requests added', () => {
  const opts = buildHelmetOptions({ isProduction: true, httpsEnabled: true });
  assert.equal(opts.strictTransportSecurity, true);
  const csp = opts.contentSecurityPolicy;
  assert.equal(csp.useDefaults, false);
  assert.deepEqual(csp.directives.upgradeInsecureRequests, [], 'upgrade-insecure-requests present and empty (no-args directive)');
});

test('helmet: development + HTTPS_ENABLED=true → still no CSP (dev convenience wins over CSP)', () => {
  // A developer playing with the prod CSP locally needs to opt in via NODE_ENV=production too.
  const opts = buildHelmetOptions({ isProduction: false, httpsEnabled: true });
  assert.equal(opts.contentSecurityPolicy, false);
  // HSTS however is unrelated to NODE_ENV — if the dev wired up TLS, respect it.
  assert.equal(opts.strictTransportSecurity, true);
});

test('helmet: cross-origin resource policy stays cross-origin in every mode', () => {
  // The dev client (:3000) loads /uploads from the API (:4000); this policy must not flip on
  // production lest the prod SPA stop loading its own files.
  for (const isProduction of [false, true]) {
    for (const httpsEnabled of [false, true]) {
      const opts = buildHelmetOptions({ isProduction, httpsEnabled });
      assert.deepEqual(opts.crossOriginResourcePolicy, { policy: 'cross-origin' });
      assert.equal(opts.crossOriginEmbedderPolicy, false);
    }
  }
});

// ----- buildSessionCookieOptions -----

test('cookie: secure flag tracks httpsEnabled exactly (no NODE_ENV dependency)', () => {
  assert.equal(buildSessionCookieOptions({ httpsEnabled: false }).secure, false);
  assert.equal(buildSessionCookieOptions({ httpsEnabled: true }).secure, true);
});

test('cookie: httpOnly + sameSite + maxAge are constants (security baseline)', () => {
  for (const httpsEnabled of [false, true]) {
    const opts = buildSessionCookieOptions({ httpsEnabled });
    assert.equal(opts.httpOnly, true, 'httpOnly always on — no JS access to the session cookie');
    assert.equal(opts.sameSite, 'lax', 'sameSite always lax — CSRF mitigation');
    assert.equal(opts.maxAge, 30 * 24 * 60 * 60 * 1000, 'sliding 30-day TTL');
  }
});

// ----- regression pin: NODE_ENV alone never re-enables HTTPS enforcement -----

test('regression: NODE_ENV=production alone does NOT re-enable HSTS or upgrade-insecure-requests', () => {
  // This was the exact bug that broke the first Raspberry Pi deploy. If a future refactor sneaks
  // back to gating HTTPS enforcement on NODE_ENV alone, this test fails.
  const opts = buildHelmetOptions({ isProduction: true, httpsEnabled: false });
  assert.equal(opts.strictTransportSecurity, false);
  assert.equal('upgradeInsecureRequests' in opts.contentSecurityPolicy.directives, false);
  // And the cookie stays sendable over plain HTTP.
  assert.equal(buildSessionCookieOptions({ httpsEnabled: false }).secure, false);
});
