// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

// E2E configuration for the smoke suite (specs/e2e-playwright-smoke-suite.md §3 + §4).
// The suite covers ~24 user-visible flows and serves as the safety net for the upcoming
// CRA → Vite migration. Browser pinned to chromium for v1.
//
// DB path resolution — the controller is `npm run test:e2e`, which sets a single
// `GUESTFLOW_E2E_DB_PATH` env var (Date.now()-stamped) BEFORE Playwright loads. The config
// + globalSetup + dbSeed all read the same env var, so server, seed and specs share one
// file. The pretest:e2e step also wipes any prior file at that path. The wipe MUST live in
// the npm script — NOT in playwright.config.js — because the config is re-evaluated by
// every worker process, which would mean we'd unlink the DB mid-suite.
const E2E_DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';
// Deterministic admin credentials seeded by `server/scripts/seed-e2e.js`.
const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e@guestflow.test';
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-secret-1234';
// Fixed session secret + encryption key so cookies / encrypted-at-rest secrets stay
// deterministic across runs. The values are TEST-ONLY — they MUST never be used in prod.
const E2E_SESSION_SECRET = 'e2e-fixed-session-secret-not-for-prod-use-32b';
const E2E_ENCRYPTION_KEY = 'e2efixedencryptionkey1234567890ab'; // 32 bytes

const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: path.join(__dirname, 'e2e', 'specs'),
  // Per-spec timeout — the slowest specs are CRUD round-trips with multiple navigations.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // No retries — see spec §3.1 rule 10 ("No flake tolerance").
  retries: 0,
  // Serial in CI to keep the ephemeral DB single-writer; faster locally with workers.
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'on-failure' }]],
  // Cached admin login from globalSetup so every spec inherits an authenticated state.
  use: {
    baseURL: 'http://localhost:3000',
    storageState: path.join(__dirname, 'e2e', '.auth', 'admin.json'),
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: require.resolve('./e2e/global-setup.js'),
  // Make the seed paths + creds visible to globalSetup + specs via `process.env`.
  metadata: {
    DB_PATH: E2E_DB_PATH,
    E2E_ADMIN_EMAIL,
  },
  webServer: [
    {
      // Backend — fresh ephemeral DB per run, fixed session secret + encryption key so the
      // storageState cookie remains valid for the whole suite.
      command: 'cd server && DB_PATH="' + E2E_DB_PATH + '" NODE_ENV=test'
        + ' GUESTFLOW_SESSION_SECRET="' + E2E_SESSION_SECRET + '"'
        + ' GUESTFLOW_ENCRYPTION_KEY="' + E2E_ENCRYPTION_KEY + '"'
        + ' PORT=4000'
        + ' node src/index.js',
      url: 'http://127.0.0.1:4000/api/version',
      // Always start fresh — see the "DB wipe at config-eval time" comment above. Reusing a
      // server from a previous run would leave the server pointing at an unlinked inode
      // while dbSeed opens a fresh empty file at the same path.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Frontend — CRA dev server. Proxies /api/* to :4000 via `client/package.json`'s
      // `proxy` field. `BROWSER=none` keeps it from popping a Safari window on macOS.
      command: 'cd client && BROWSER=none PORT=3000 npm start',
      url: 'http://localhost:3000',
      // Always start fresh — see the "DB wipe at config-eval time" comment above. Reusing a
      // server from a previous run would leave the server pointing at an unlinked inode
      // while dbSeed opens a fresh empty file at the same path.
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
