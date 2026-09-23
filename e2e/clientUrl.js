// @ts-check
// The client dev-server origin every E2E actor must use: the browser, the storageState cookie and
// every API seed helper. It is 3000 by default and follows E2E_CLIENT_PORT when another app on the
// machine already holds that port — running the suite against a stranger's server is worse than
// failing, hence `--strictPort` in playwright.config.js.
//
// CommonJS on purpose: playwright.config.js and the fixtures require() it, the specs import it.

const CLIENT_PORT = process.env.E2E_CLIENT_PORT || '3000';
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;

module.exports = { CLIENT_PORT, CLIENT_URL };
