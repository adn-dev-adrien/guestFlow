// @ts-check
// The bare-install E2E suite (specs/plugins-phase-0-foundation.md rule 28): the same harness as
// playwright.config.js, on its own database, seeded with NO plugin — a new customer after the start
// assistant — and running only e2e/bare. `npm run test:e2e:bare`.
//
// The database path and the seed choice are set before the main config evaluates, so its webServer
// command, the global setup and the specs (re-evaluated in every worker) all read them.
process.env.GUESTFLOW_E2E_DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e-bare.db';
process.env.E2E_SEED_PLUGINS = 'none';

const path = require('path');
const base = require('./playwright.config');

const isCI = Boolean(process.env.CI);

module.exports = {
  ...base,
  testDir: path.join(__dirname, 'e2e', 'bare'),
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-bare' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report-bare' }]],
  metadata: { ...base.metadata, DB_PATH: process.env.GUESTFLOW_E2E_DB_PATH },
};
