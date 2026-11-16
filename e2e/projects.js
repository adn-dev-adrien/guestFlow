// The layout of the Playwright projects (specs/e2e-playwright-smoke-suite.md rule 20), with no dependency so
// that both playwright.config.js and a server unit test can read it.
//
// Specs that rewrite global state never overlap another spec: each gets a project of its own that depends
// on the main one. A dependency is the only way Playwright orders projects, so a failure of the main
// project skips them — the price of never running a VAT or laundry spec against a state in flux.

const BANK_RECONCILIATION_SPEC = /reconciliation-assisted-matching\.spec\.js$/;
// The laundry-days spec rewrites the global laundry schedule (Tuesday + Thursday for a while): a spec that
// places an extra trip on a « free » Thursday (laundry-extra-trip) would be refused if it ran meanwhile.
const LAUNDRY_SCHEDULE_SPEC = /laundry-days\.spec\.js$/;
// Specs that switch a plugin off and on again (global state: its routes answer 404 and its pages show their empty state meanwhile). Run beside the
// specs that use the plugin, hourly-resources.spec.js made outside-visit and hourly-resources-client-picker fail in every parallel run (loop t2).
const PLUGIN_TOGGLE_SPECS = [/(^|\/)hourly-resources\.spec\.js$/, /(^|\/)neat\.spec\.js$/, /(^|\/)online-payment\.spec\.js$/, /(^|\/)plugins-page\.spec\.js$/, /(^|\/)booking-intake\.spec\.js$/];
// Specs that rewrite the global VAT regime / rate, in the order they run.
const VAT_STATE_SPECS = [/vat-regime-switch\.spec\.js$/, /vat-franchise\.spec\.js$/, /vat-roundtrip\.spec\.js$/];

const PROJECTS = [
  { name: 'chromium', testIgnore: [BANK_RECONCILIATION_SPEC, LAUNDRY_SCHEDULE_SPEC, ...VAT_STATE_SPECS, ...PLUGIN_TOGGLE_SPECS] },
  // Right after the main project and before the other global-state projects: online-payment.spec.js reads a database where no provider is
  // connected, which bank-reconciliation ends.
  { name: 'plugin-toggles', testMatch: PLUGIN_TOGGLE_SPECS, dependencies: ['chromium'] },
  // Seeds a stored Qonto connection into the shared database.
  { name: 'bank-reconciliation', testMatch: BANK_RECONCILIATION_SPEC, dependencies: ['plugin-toggles'] },
  { name: 'laundry-schedule', testMatch: LAUNDRY_SCHEDULE_SPEC, dependencies: ['plugin-toggles'] },
  { name: 'vat-regime', testMatch: VAT_STATE_SPECS[0], dependencies: ['plugin-toggles'] },
  { name: 'vat-franchise', testMatch: VAT_STATE_SPECS[1], dependencies: ['vat-regime'] },
  { name: 'vat-rate', testMatch: VAT_STATE_SPECS[2], dependencies: ['vat-franchise'] },
];

module.exports = { PROJECTS };
