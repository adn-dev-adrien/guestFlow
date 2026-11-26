// @ts-check
// The client dev-server origin every E2E actor must use: the browser, the storageState cookie and
// every API seed helper. It is 3000 by default and follows E2E_CLIENT_PORT when another app on the
// machine already holds that port — running the suite against a stranger's server is worse than
// failing, hence `--strictPort` in playwright.config.js.
//
// CommonJS on purpose: playwright.config.js and the fixtures require() it, the specs import it.

const CLIENT_PORT = process.env.E2E_CLIENT_PORT || '3000';
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
// The backend the suite starts, 4000 by default. E2E_SERVER_PORT moves it when a dev server already
// holds 4000: the Vite server of the suite then proxies to it (GUESTFLOW_API_PORT, client/vite.config.js).
const SERVER_PORT = process.env.E2E_SERVER_PORT || '4000';

// The budget of one API call made by the suite itself (seeds, read-backs), apart from the 5 s UI action budget
// (specs/tech/e2e-playwright-smoke-suite.md rule 19, reading of 2026-11-16): a request context created in a test
// inherits `actionTimeout`, and one call stalled on the dev-proxy hop then failed a test whose server answered in ms.
const API_TIMEOUT = 15_000;

module.exports = { CLIENT_PORT, CLIENT_URL, SERVER_PORT, API_TIMEOUT };
