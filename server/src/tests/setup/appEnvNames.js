/**
 * The environment the `npm test` preload clears (specs/server-test-isolation.md rule 12, reading of
 * 2026-11-01): every `GUESTFLOW_*` variable but the runner's `GUESTFLOW_TEST_*` knobs, by prefix, and every
 * other variable the app reads, by name, so a developer shell carrying production settings
 * (`PUBLIC_SITE_ORIGIN`, a rate-limit knob, QONTO_*) runs the suite as CI does.
 *
 * `server-test-app-env.unit.test.js` derives the app's reads from `src/` and fails on a name that is on
 * neither list, or on a listed name `src/` no longer reads.
 *
 * - `APP_ENV_NAMES`: deleted at start-up. Case counts: `pm_id` is the one pm2 sets, which
 *   `processRestart` reads to tell it runs supervised.
 * - `RUNNER_ENV_NAMES`: read by the app but left to the runner. `DB_PATH`, `PERSISTENT_DB` and `TMPDIR`
 *   are then replaced or deleted by the isolation of rules 1 and 4; `TZ` stays because a clock sweep sets
 *   it on purpose; `NODE_ENV` stays only when it is `test` (see `stripAppEnv`).
 */
const APP_ENV_NAMES = [
  'API_RATELIMIT_MAX', 'API_RATELIMIT_WINDOW_MS',
  'APP_COMMIT_SHA', 'COMMIT_SHA', 'GITHUB_SHA',
  'BASE_URL', 'CORS_ORIGINS', 'TRUST_PROXY_HOPS', 'PORT',
  'BOOKING_REQUEST_RATELIMIT_MAX', 'BOOKING_REQUEST_RATELIMIT_WINDOW_MS',
  'DEBUG_RESOURCE_LINES',
  'EMAIL_PREFERENCES_RATELIMIT_MAX',
  'GATE_API_KEY', 'GATE_SIGNING_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI',
  'HTTPS_ENABLED', 'TLS_CERT_PATH', 'TLS_KEY_PATH',
  'LOGIN_RATELIMIT_MAX', 'LOGIN_RATELIMIT_WINDOW_MS',
  'NEAT_API_BASE',
  'pm_id',
  'PAYMENT_POLL_COLD_INTERVAL_MINUTES', 'PAYMENT_POLL_FRESH_HOURS', 'PAYMENT_POLL_TICK_MINUTES',
  'PAYMENT_POLL_WARM_DAYS', 'PAYMENT_POLL_WARM_INTERVAL_MINUTES',
  'PAYMENT_START_RATELIMIT_MAX', 'PAYMENT_START_RATELIMIT_WINDOW_MS',
  'PAYMENT_STATUS_RATELIMIT_MAX', 'PAYMENT_STATUS_RATELIMIT_WINDOW_MS',
  'PUBLIC_API_KEY', 'PUBLIC_API_RATELIMIT_MAX', 'PUBLIC_API_RATELIMIT_WINDOW_MS',
  'PUBLIC_REQUEST_CHALLENGE_SECRET', 'PUBLIC_SITE_ORIGIN', 'ROOSTVIEW_API_KEY',
  'QONTO_API_BASE', 'QONTO_CLIENT_ID', 'QONTO_CLIENT_SECRET', 'QONTO_ENV', 'QONTO_OAUTH_BASE',
  'QONTO_REDIRECT_URI', 'QONTO_REQUEST_TIMEOUT_MS', 'QONTO_RETRY_BASE_DELAY_MS', 'QONTO_RETRY_MAX_ATTEMPTS',
  'QONTO_RETRY_MAX_DELAY_MS', 'QONTO_STAGING_TOKEN', 'QONTO_WEBHOOK_SECRET', 'QONTO_WEBHOOK_SIGNATURE_HEADER',
  'SKIP_MIGRATIONS',
  'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
];

const RUNNER_ENV_NAMES = ['PATH', 'TMPDIR', 'TZ', 'NODE_ENV', 'NODE_TEST_CONTEXT', 'DB_PATH', 'PERSISTENT_DB'];

function stripAppEnv(env = process.env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith('GUESTFLOW_') && !name.startsWith('GUESTFLOW_TEST_')) delete env[name];
  }
  for (const name of APP_ENV_NAMES) delete env[name];
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== 'test') delete env.NODE_ENV;
}

module.exports = { APP_ENV_NAMES, RUNNER_ENV_NAMES, stripAppEnv };
