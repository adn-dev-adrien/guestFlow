// @ts-check
// Storage-state paths written by `e2e/global-setup.js` (specs/e2e-playwright-smoke-suite.md §4.3).
//
// `admin.json` is the suite-wide default (playwright.config.js `use.storageState`), so specs only
// need this module when they want a DIFFERENT session — today the « Accueil » account
// (specs/reception-role-checkin-only.md, specs/reception-sas-today-only.md):
//
//   const { RECEPTION_STORAGE_STATE } = require('../../fixtures/authState.js');
//   test.use({ storageState: RECEPTION_STORAGE_STATE });
//
// Resolved from `__dirname` so the paths hold whatever the cwd is, and so no spec has to spell out
// an absolute path. Deliberately CommonJS + no `import.meta`, which would flip the importing spec to
// a real ES module and break the CJS fixtures it loads alongside.

const path = require('path');

const AUTH_DIR = path.join(__dirname, '..', '.auth');

module.exports = {
  ADMIN_STORAGE_STATE: path.join(AUTH_DIR, 'admin.json'),
  RECEPTION_STORAGE_STATE: path.join(AUTH_DIR, 'reception.json'),
};
