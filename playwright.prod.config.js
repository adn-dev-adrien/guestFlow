// @ts-check
// The production-build E2E suite (specs/plugins-phase-4-registry.md rule 19): the server serves the
// built client and loads every plugin from its package, as a release does, beside a test registry.
// `npm run test:e2e:prod` — the client (client/dist) and the packages (plugins-dist) are built by
// e2e/prod/serve.js when missing; CI builds them first.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const PORT = process.env.E2E_PROD_PORT || '4300';
const REGISTRY_PORT = process.env.E2E_REGISTRY_PORT || '4301';
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: path.join(__dirname, 'e2e', 'prod'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-prod' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: path.join(__dirname, 'e2e', '.auth', 'prod-admin.json'),
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: require.resolve('./e2e/prod/global-setup.js'),
  webServer: {
    command: `E2E_PROD_PORT=${PORT} E2E_REGISTRY_PORT=${REGISTRY_PORT} node e2e/prod/serve.js`,
    url: `http://127.0.0.1:${PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
