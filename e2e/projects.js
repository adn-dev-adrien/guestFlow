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
// Specs that rewrite the global VAT regime / rate, in the order they run.
const VAT_STATE_SPECS = [/vat-regime-switch\.spec\.js$/, /vat-franchise\.spec\.js$/, /vat-roundtrip\.spec\.js$/];

const PROJECTS = [
  { name: 'chromium', testIgnore: [BANK_RECONCILIATION_SPEC, LAUNDRY_SCHEDULE_SPEC, ...VAT_STATE_SPECS] },
  // Seeds a stored Qonto connection into the shared database.
  { name: 'bank-reconciliation', testMatch: BANK_RECONCILIATION_SPEC, dependencies: ['chromium'] },
  { name: 'laundry-schedule', testMatch: LAUNDRY_SCHEDULE_SPEC, dependencies: ['chromium'] },
  { name: 'vat-regime', testMatch: VAT_STATE_SPECS[0], dependencies: ['chromium'] },
  { name: 'vat-franchise', testMatch: VAT_STATE_SPECS[1], dependencies: ['vat-regime'] },
  { name: 'vat-rate', testMatch: VAT_STATE_SPECS[2], dependencies: ['vat-franchise'] },
];

module.exports = { PROJECTS };
