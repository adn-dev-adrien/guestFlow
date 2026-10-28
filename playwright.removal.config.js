// @ts-check
// The removal matrix's E2E suite (specs/plugin-removal-resilience.md rules 8-12, 15-17): the production
// build on the seeded database of a cell. `node scripts/plugin-removal.mjs cell <id>` runs it with the
// plugin removed; `... sweep` runs the toggle sweep with every plugin present.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const PORT = process.env.E2E_REMOVAL_PORT || '4400';
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: path.join(__dirname, 'e2e', 'removal'),
  timeout: 240_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-removal' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: path.join(__dirname, 'e2e', '.auth', `removal-admin-${PORT}.json`),
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: require.resolve('./e2e/removal/global-setup.js'),
  webServer: {
    command: 'node e2e/removal/serve.js',
    url: `http://127.0.0.1:${PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
