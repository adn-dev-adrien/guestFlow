// specs/server-test-isolation.md rules 6, 7, 8 and 9, and specs/self-update-and-releases.md rule 52 (audit R8,
// 2026-10-30) — no test goes red with the calendar, a PR adding a literal date to a test is told so (but not
// for a line already merged on a long-lived branch), and the unit suites fit their CI time budget. Rule 7,
// reading of 2026-11-03 (audit R20-S2): a past date within the five-year window is named too, and a clock the
// test only injects is no pin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'check-test-dates.mjs')).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const asAdded = (file, content) => ({ file, content, added: content.split('\n').map((text, i) => ({ line: i + 1, text })) });

const TESTS = 'server/src/tests';
const suitesOf = (fixture) => fs.readdirSync(path.join(ROOT, TESTS))
  .filter((f) => f.endsWith('.test.js') && new RegExp(`require\\('\\./${fixture}'\\)`).test(read(`${TESTS}/${f}`)))
  .map((f) => `${TESTS}/${f}`);
const SAVE_FIXTURE_SUITES = suitesOf('reservationSaveFixture');
const LEDGER_FIXTURE_SUITES = suitesOf('ledgerFixture');

// specs/server-test-isolation.md rule 7, reading of 2026-11-03 (audit R20-S2): the suites whose dates the five-year
// window would have dropped by 2031 (136 server tests), now hung on today, and the reconciliation fixture's family.
const R20_SWEEP = [
  'scripts/check-test-dates.mjs',
  'server/src/plugins/accounting-export/tests/accounting-gross-up-ignores-contribs.unit.test.js',
  'server/src/plugins/hourly-resources/tests/resource-occupancy-conflicts.unit.test.js',
  'server/src/plugins/linen/tests/laundry-extra-trips-endpoint.unit.test.js',
  'server/src/plugins/linen/tests/laundry-manual-additions-endpoint.unit.test.js',
  'server/src/plugins/linen/tests/laundry-skips-endpoint.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-allocation.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-auto-confirm.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-confirm-all.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-controller.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-converted-devis-link.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-credit-to-receipts.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-deadline-decorator.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-expected-receipts.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-fiche-credits.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-grouped-payouts.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-installments-core-module.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-link-batch.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-money-review.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-page-filters.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-penalty.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-platform-acompte.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-platform-follows-ledger.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-review-fixes.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliation-split-payments.unit.test.js',
  'server/src/plugins/online-payment/tests/reconciliationFixture.js',
  'server/src/plugins/online-payment/tests/reservation-payment-mark.unit.test.js',
  'server/src/plugins/school-holidays/tests/school-holidays-validation.unit.test.js',
  'server/src/plugins/tariff-recipes/tests/tariff-recipe-apply.unit.test.js',
  `${TESTS}/collected-tax-kept-on-save.unit.test.js`,
  `${TESTS}/dashboard-controller-ical-cancellation.unit.test.js`,
  `${TESTS}/devis-model-create.unit.test.js`,
  `${TESTS}/devis-model-createdAt-validUntil.unit.test.js`,
  `${TESTS}/devis-model-pdf-language.unit.test.js`,
  `${TESTS}/devis-model-property-defaults.unit.test.js`,
  `${TESTS}/email-manual-queue.unit.test.js`,
  `${TESTS}/establishment-closures-bounds.unit.test.js`,
  `${TESTS}/establishment-closures-validation.unit.test.js`,
  `${TESTS}/fiche-save-keeps-the-payment.unit.test.js`,
  `${TESTS}/finance-window.unit.test.js`,
  `${TESTS}/ical-date-drift-model.unit.test.js`,
  `${TESTS}/ledger-link-amount-mismatch.unit.test.js`,
  `${TESTS}/past-fiche-keeps-its-solde-deadline.unit.test.js`,
  `${TESTS}/platform-price-check.unit.test.js`,
  `${TESTS}/properties-model-assign-date-range.unit.test.js`,
  `${TESTS}/properties-model.unit.test.js`,
  `${TESTS}/public-booking-request-default-options.unit.test.js`,
  `${TESTS}/public-devis-options-persist.unit.test.js`,
  `${TESTS}/reservation-ledger-amounts.unit.test.js`,
  `${TESTS}/reservation-ledger-links.unit.test.js`,
  `${TESTS}/reservation-ledger-marks.unit.test.js`,
  `${TESTS}/reservation-ledger-parity.unit.test.js`,
  `${TESTS}/stored-split-only-with-contribs.unit.test.js`,
  `${TESTS}/tariff-change-journal.unit.test.js`,
  `${TESTS}/zero-deposit-deadline-legacy-rows.unit.test.js`,
  // Audit R21-S4: the literals left that the calendar reaches before 2031.
  `${TESTS}/devis-pdf-quote-parity.unit.test.js`,
  `${TESTS}/devis-price-lock.unit.test.js`,
  `${TESTS}/payment-link-quote-parity.unit.test.js`,
  `${TESTS}/vat-regime-preview.unit.test.js`,
];

test('rule 6: the suites the audits found, and every suite of the reservation-save and ledger fixtures, carry no date the calendar will pass', async () => {
  const { findDateBombs, localToday } = await load();
  assert.ok(SAVE_FIXTURE_SUITES.length >= 17, SAVE_FIXTURE_SUITES.join(', '));
  assert.ok(LEDGER_FIXTURE_SUITES.length >= 9, LEDGER_FIXTURE_SUITES.join(', '));
  const files = [...new Set([
    `${TESTS}/disabledAcompteLinkFixture.js`,
    `${TESTS}/deposit-collected-by-link-kept-on-save.unit.test.js`,
    `${TESTS}/deposit-link-paid-on-disabled-acompte.unit.test.js`,
    `${TESTS}/deposit-link-paid-on-paid-solde.unit.test.js`,
    `${TESTS}/deposit-due-date-and-override-history.unit.test.js`,
    `${TESTS}/payment-links-converted-devis-double-payment.unit.test.js`,
    `${TESTS}/reservation-overpayment.unit.test.js`,
    `${TESTS}/kept-money-priced-closes-trop-percu.unit.test.js`,
    `${TESTS}/trop-percu-refund-books.unit.test.js`,
    'server/src/plugins/accounting-export/tests/accounting-paid-then-reduced.unit.test.js',
    `${TESTS}/hourly-session-overlap.unit.test.js`,
    `${TESTS}/ledger-stored-deposit-ceiling.unit.test.js`,
    `${TESTS}/platform-paid-solde-follows-statement.unit.test.js`,
    `${TESTS}/reservationSaveFixture.js`,
    ...SAVE_FIXTURE_SUITES,
    `${TESTS}/clients-no-duplicate-and-draft.unit.test.js`,
    `${TESTS}/reservation-overpayment-by-poste.unit.test.js`,
    `${TESTS}/calendar-parity-superseded.unit.test.js`,
    `${TESTS}/clients-duplicate-created-from-the-fiche.unit.test.js`,
    'server/src/plugins/accounting-export/tests/stay-payment-split-fallback.unit.test.js',
    `${TESTS}/baby-bed-line-stored-on-create.unit.test.js`,
    `${TESTS}/ical-nameless-summary-matching.unit.test.js`,
    `${TESTS}/lodgify-decommission-native-feeds.unit.test.js`,
    `${TESTS}/ical-cancelled-stay-dropped.unit.test.js`,
    `${TESTS}/ledgerFixture.js`,
    ...LEDGER_FIXTURE_SUITES,
    ...R20_SWEEP,
  // specs/plugin-removal-resilience.md rule 19 (audit R21-S2): a removed plugin takes its tests with it, and the date
  // check stays complete for whatever the tree ships.
  ])].filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => asAdded(f, read(f)));
  assert.deepEqual(findDateBombs({ files, today: localToday() }), []);
});

test('rule 7: a quoted date, a template opening on a year or a Date.UTC year from today on is named, with its file and line', async () => {
  const { findDateBombs } = await load();
  const content = [
    "const id = f.createStay({ startDate: '2027-11-02', endDate: '2027-11-05' });", // date-literal-ok: input or output of the guard under test
    'const day = (o) => new Date(Date.UTC(2027, 5, 1 + o)).toISOString();', // date-literal-ok: input or output of the guard under test
    "const paidAt = '2027-03-01T09:00:00Z';", // date-literal-ok: input or output of the guard under test
    "const old = '2021-10-29';", // date-literal-ok: input or output of the guard under test
    'const start = `2028-${m}-10`;', // date-literal-ok: input or output of the guard under test
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }), [ // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 1, literal: '2027-11-02' }, // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 1, literal: '2027-11-05' }, // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 2, literal: 'Date.UTC(2027, …)' }, // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 3, literal: '2027-03-01' }, // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 5, literal: '`2028-${…}`' }, // date-literal-ok: input or output of the guard under test
  ]);
});

test('rule 7: only the lines a PR adds are read, as the diff numbers them', async () => {
  const { parseAddedLines } = await load();
  const diff = [
    'diff --git a/server/src/tests/x.unit.test.js b/server/src/tests/x.unit.test.js',
    '--- a/server/src/tests/x.unit.test.js',
    '+++ b/server/src/tests/x.unit.test.js',
    '@@ -3,0 +4,2 @@ test(',
    "+const a = '2027-01-01';", // date-literal-ok: input or output of the guard under test
    "+const b = '2027-01-02';", // date-literal-ok: input or output of the guard under test
    '@@ -10 +12 @@',
    "-const c = '2027-01-03';", // date-literal-ok: input or output of the guard under test
    "+const c = '2027-01-04';", // date-literal-ok: input or output of the guard under test
    'diff --git a/gone.test.js b/gone.test.js',
    '--- a/gone.test.js',
    '+++ /dev/null',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff), [{
    file: 'server/src/tests/x.unit.test.js',
    added: [{ line: 4, text: "const a = '2027-01-01';" }, { line: 5, text: "const b = '2027-01-02';" }, { line: 12, text: "const c = '2027-01-04';" }], // date-literal-ok: input or output of the guard under test
  }]);
});

test('rule 7: the marker, a pinned clock, a comment, the far future and non-test files are not named', async () => {
  const { findDateBombs, isTestFile } = await load();
  const today = '2026-10-30'; // date-literal-ok: input or output of the guard under test
  const marked = [
    "price({ date: '2027-07-14' }); // date-literal-ok: a pure function of its input",
    '// date-literal-ok: the season table is the subject',
    "const season = '2027-07-01';",
    "// The stay of '2027-01-01' is the one the audit saw.", // date-literal-ok: input or output of the guard under test
    "const far = '2099-06-01';",
  ].join('\n');
  const pinned = "vi.setSystemTime(new Date('2027-06-15T10:00:00'));\nconst d = '2027-06-20';"; // date-literal-ok: input or output of the guard under test
  const nodePinned = "mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-05') });\nconst d = '2027-01-06';"; // date-literal-ok: input or output of the guard under test
  assert.deepEqual(findDateBombs({
    today,
    files: [
      asAdded('server/src/tests/a.unit.test.js', marked),
      asAdded('client/src/pages/__tests__/B.test.jsx', pinned),
      asAdded('server/src/plugins/x/tests/c.unit.test.js', nodePinned),
      asAdded('server/src/utils/pricing.js', "const d = '2027-01-01';"), // date-literal-ok: input or output of the guard under test
      asAdded('server/src/tests/fixtures/stays.json', '{ "startDate": "2027-01-01" }'), // date-literal-ok: input or output of the guard under test
    ],
  }), []);
  assert.equal(isTestFile('e2e/booking.spec.js'), true);
  assert.equal(isTestFile('server/src/tests/disabledAcompteLinkFixture.js'), true);
  assert.equal(isTestFile('client/node_modules/x/tests/a.js'), false);
});

test('rule 7: a timer mock that leaves Date alone pins nothing', async () => {
  const { findDateBombs } = await load();
  const content = [
    "mock.timers.enable({ apis: ['setTimeout'] });",
    "createStay({ startDate: '2027-01-24' });", // date-literal-ok: input of the guard under test
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }), [ // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 2, literal: '2027-01-24' }, // date-literal-ok: input or output of the guard under test
  ]);
  const all = "mock.timers.enable();\ncreateStay({ startDate: '2027-01-24' });"; // date-literal-ok: guard input
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/y.unit.test.js', all)], today: '2026-10-30' }), []);
});

test('rule 7: a clock pinned inside one test exempts that test, not its neighbours', async () => {
  const { findDateBombs } = await load();
  const content = [
    "test('pinned', (t) => {",
    "  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-05T10:00:00Z') });", // date-literal-ok: guard input
    "  assert.equal(due('2027-01-06'), 'tomorrow');", // date-literal-ok: guard input
    '});',
    "test('free', () => {",
    "  createStay({ startDate: '2027-01-24', note: 'vi.setSystemTime( is only text here' });", // date-literal-ok: guard input
    '});',
    "describe('pinned block', () => {",
    "  beforeEach(() => { vi.setSystemTime(new Date('2027-06-15T10:00:00')); });", // date-literal-ok: guard input
    "  it('reads it', () => { expect(label('2027-06-16')).toBe('demain'); });", // date-literal-ok: guard input
    '});',
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }), [ // date-literal-ok: input or output of the guard under test
    { file: 'server/src/tests/x.unit.test.js', line: 6, literal: '2027-01-24' }, // date-literal-ok: input or output of the guard under test
  ]);
});

test('rule 7, reading of 2026-11-03 (audit R20-S2): a clock the test only injects — a replaced getTodayIsoDate / todayIso, a NOW constant, a now: handed to the code — exempts nothing, since the date window reads the real clock', async () => {
  const { findDateBombs } = await load();
  const content = [
    "test('stubbed today', () => {",
    "  reservationHelpers.getTodayIsoDate = () => '2027-01-01';", // date-literal-ok: guard input
    "  assert.equal(stale('2027-01-02'), false);", // date-literal-ok: guard input
    '});',
    "test('injected now', () => {",
    "  const NOW = new Date('2027-03-01T10:00:00Z');", // date-literal-ok: guard input
    "  assert.equal(validUntil({ now: NOW, stay: '2027-03-05' }), true);", // date-literal-ok: guard input
    '});',
    "test('a now handed in place', () => {",
    "  run({ id: 1, now: () => Date.parse('2027-04-01T10:00:00Z') }, '2027-04-03');", // date-literal-ok: guard input
    '});',
    "test('the pure function it is handed to', () => {",
    "  // date-literal-ok: the clock is injected into this pure function, no write path reads the date",
    "  assert.equal(validUntil({ now: new Date('2027-03-01T10:00:00Z'), stay: '2027-03-05' }), true);", // date-literal-ok: guard input
    '});',
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [2, '2027-01-01'], [3, '2027-01-02'], [6, '2027-03-01'], [7, '2027-03-05'], [10, '2027-04-01'], [10, '2027-04-03'], // date-literal-ok: guard output
  ]);
  const fileWide = "dateUtils.todayIso = () => '2027-06-01';\ntest('a', () => { assert.ok(open('2027-06-02')); });"; // date-literal-ok: guard input
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/y.unit.test.js', fileWide)], today: '2026-10-30' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [1, '2027-06-01'], [2, '2027-06-02'], // date-literal-ok: guard output
  ]);
});

test('rule 7, reading of 2026-11-03 (audit R20-S2): a past date the five-year window will drop is named, from today − 5 years on (a 29 February landing on the 28th)', async () => {
  const { findDateBombs, datesInReach } = await load();
  const content = [
    "mark(id, { balancePaidDate: '2026-10-12' });", // date-literal-ok: guard input
    "mark(id, { balancePaidDate: '2026-12-12' });", // date-literal-ok: guard input
    "ctl.pending({ query: { today: '2026-01-01' } }, r);", // date-literal-ok: guard input
    "const opened = '2021-11-03';", // date-literal-ok: guard input
    "const refused = '2021-11-02';", // date-literal-ok: guard input
    "const ical = '20220115';", // date-literal-ok: guard input
    'const first = `2021-${m}-10`;', // date-literal-ok: guard input
    'const before = `2020-${m}-10`;', // date-literal-ok: guard input
    'const stamp = Date.UTC(2023, 0, 1);', // date-literal-ok: guard input
    'const older = new Date(2020, 0, 1);', // date-literal-ok: guard input
    "mark(id, { balancePaidDate: '2026-02-30' }); expect(bad('2026-13-01')); feed('20260231');", // date-literal-ok: guard input
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-11-03' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [1, '2026-10-12'], [2, '2026-12-12'], [3, '2026-01-01'], [4, '2021-11-03'], [6, '20220115'], [7, '`2021-${…}`'], [9, 'Date.UTC(2023, …)'], // date-literal-ok: guard output
  ]);
  // date-literal-ok: the window's start on a 29 February, input and output of the pure function under test
  assert.deepEqual(datesInReach("'2023-02-28' '2023-02-27' '2038-02-28' '2038-03-01'", '2028-02-29').map((d) => d.date), ['2023-02-28', '2038-02-28']);
  const { horizonStart } = require('../utils/stayDates');
  for (const today of ['2026-11-03', '2028-02-29', '2027-01-01']) { // date-literal-ok: input of the pure function under test
    const start = horizonStart(today);
    const before = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    assert.deepEqual(datesInReach(`'${before}' '${start}'`, today).map((d) => d.date), [start], `the checker opens where the window does, on ${today}`);
  }
});

// Review of PR #943 (nit closed 2026-11-03): the far end is inclusive — today + 10 years is still named, the
// day after is the far future. A year alone follows the same bound.
test('rule 7: a date is named up to today + 10 years included, and not one day further', async () => {
  const { datesInReach } = await load();
  const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  for (const today of ['2026-11-03', '2027-12-31', '2028-02-29']) { // date-literal-ok: input of the pure function under test
    const year = Number(today.slice(0, 4));
    const last = `${year + 10}${today.slice(4)}`.replace(/-02-29$/, '-02-28');
    const days = datesInReach(`'${last}' '${shift(last, 1)}'`, today).map((d) => d.date);
    assert.deepEqual(days, [last], `the checker's far end on ${today}`);
    const years = datesInReach(`\`${year + 10}-\${m}\` Date.UTC(${year + 10}, 0, 1) \`${year + 11}-\${m}\` Date.UTC(${year + 11}, 0, 1)`, today).map((d) => d.date);
    assert.deepEqual(years, [String(year + 10), String(year + 10)], `a year alone on ${today}`);
  }
});

test('rule 7: a pin in a helper covers the tests that call it, a test.each callback holds its own pin, a fake timer that leaves Date real pins nothing', async () => {
  const { findDateBombs } = await load();
  const content = [
    "function freeze(t) { t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-02-01T10:00:00Z') }); }", // date-literal-ok: guard input
    "const freezeArrow = (t) => { t.mock.timers.enable({ apis: ['Date'], now: 0 }); };",
    "test('frozen', (t) => { freeze(t); assert.ok(due('2027-02-02')); });", // date-literal-ok: guard input
    "test('free', () => { createStay({ startDate: '2027-02-03' }); });", // date-literal-ok: guard input
    "test.each([[1], [2]])('each %s', (n) => {",
    "  vi.setSystemTime(new Date('2027-03-01T10:00:00Z'));", // date-literal-ok: guard input
    "  expect(label('2027-03-02')).toBe('demain');", // date-literal-ok: guard input
    '});',
    "it('timeouts only', () => {",
    "  vi.useFakeTimers({ toFake: ['setTimeout'], now: new Date('2027-04-01T10:00:00Z') });", // date-literal-ok: guard input
    "  createStay({ startDate: '2027-04-02' });", // date-literal-ok: guard input
    '});',
    "it('arrow helper', (t) => { freezeArrow(t); assert.ok(due('2027-05-02')); });", // date-literal-ok: guard input
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [4, '2027-02-03'], [10, '2027-04-01'], [11, '2027-04-02'], // date-literal-ok: guard output
  ]);
  const hook = "test.beforeEach(() => { vi.setSystemTime(new Date('2027-06-15T10:00:00')); });\ntest('a', () => { label('2027-06-16'); });"; // date-literal-ok: guard input
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/y.unit.test.js', hook)], today: '2026-10-30' }), [], 'a top-level hook pins the file'); // date-literal-ok: guard input
  const asyncHook = "beforeEach(async () => { vi.setSystemTime(new Date('2027-06-15T10:00:00')); });\ntest('a', () => { label('2027-06-16'); });"; // date-literal-ok: guard input
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/z.unit.test.js', asyncHook)], today: '2026-10-30' }), [], 'an async top-level hook pins the file too'); // date-literal-ok: guard input
});

test('rule 9: a line whose file and text already exist on a known branch is not named', async () => {
  const { dropKnownLines } = await load();
  const files = [
    { file: 'server/src/tests/a.unit.test.js', content: '', added: [{ line: 3, text: "  createStay({ startDate: '2027-01-24' });" }, { line: 4, text: "  createStay({ startDate: '2027-02-12' });" }] }, // date-literal-ok: guard input
    { file: 'server/src/tests/b.unit.test.js', content: '', added: [{ line: 1, text: "createStay({ startDate: '2027-01-24' });" }] }, // date-literal-ok: guard input
  ];
  const known = (file) => (file === 'server/src/tests/a.unit.test.js' ? ["test('x', () => {\ncreateStay({ startDate: '2027-01-24' });\n});"] : []); // date-literal-ok: guard input
  assert.deepEqual(dropKnownLines(files, known), [
    { file: 'server/src/tests/a.unit.test.js', content: '', added: [{ line: 4, text: "  createStay({ startDate: '2027-02-12' });" }] }, // date-literal-ok: guard input
    { file: 'server/src/tests/b.unit.test.js', content: '', added: [{ line: 1, text: "createStay({ startDate: '2027-01-24' });" }] }, // date-literal-ok: guard input
  ]);
});

test('rule 7: a quoted compact iCal date (YYYYMMDD, alone or opening a timestamp) is named like a dashed one', async () => {
  const { findDateBombs } = await load();
  const content = [
    "feed([{ uid: 'G1', start: '20271105', end: '20271110' }]);", // date-literal-ok: guard input
    "const stamp = '20280301T090000Z';", // date-literal-ok: guard input
    "const old = '20211029';", // date-literal-ok: guard input
    'const line = `DTSTART;VALUE=DATE:20271105`;', // date-literal-ok: guard input
    "const n = '202711051';", // date-literal-ok: guard input
    "const far = '20990601';", // date-literal-ok: guard input
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [1, '20271105'], [1, '20271110'], [2, '20280301'], // date-literal-ok: guard output
  ]);
});

test('rule 7: a pin inside an object or class method covers the method and its callers, not the file', async () => {
  const { findDateBombs } = await load();
  const content = [
    'const h = {',
    '  freeze(t) { t.mock.timers.enable({ now: 0 }); },',
    '  thaw: (t) => { t.mock.timers.reset(); },',
    '};',
    'class Clock {',
    "  static pin() { vi.setSystemTime(new Date('2027-01-01T10:00:00Z')); }", // date-literal-ok: guard input
    '}',
    "test('frozen', (t) => { h.freeze(t); assert.ok(due('2027-05-10')); });", // date-literal-ok: guard input
    "test('pinned', () => { Clock.pin(); assert.ok(due('2027-05-12')); });", // date-literal-ok: guard input
    "test('free', () => { createStay({ startDate: '2027-05-11' }); });", // date-literal-ok: guard input
    'if (ready) { createStay({ startDate: "2027-05-13" }); }', // date-literal-ok: guard input
  ].join('\n');
  assert.deepEqual(findDateBombs({ files: [asAdded('server/src/tests/x.unit.test.js', content)], today: '2026-10-30' }).map((b) => [b.line, b.literal]), [ // date-literal-ok: guard input
    [10, '2027-05-11'], [11, '2027-05-13'], // date-literal-ok: guard output
  ]);
});

test('rule 9: a known line copied again into its own file is named — counts are compared, not presence', async () => {
  const { dropKnownLines } = await load();
  const line = "  createStay({ startDate: '2027-07-20' });"; // date-literal-ok: guard input
  const known = () => [`test('a', (t) => {\n  t.mock.timers.enable({ now });\n${line}\n});`, `${line}\n${line}`];
  const head = (n) => [`test('a', (t) => {`, '  t.mock.timers.enable({ now });', ...Array(n).fill(line), '});'].join('\n');
  const twice = { file: 'server/src/tests/a.unit.test.js', content: head(2), added: [{ line: 4, text: line }] };
  assert.deepEqual(dropKnownLines([twice], known)[0].added, [], 'two copies, two on the richest known ref');
  const thrice = { file: 'server/src/tests/a.unit.test.js', content: head(3), added: [{ line: 5, text: line }] };
  assert.deepEqual(dropKnownLines([thrice], known)[0].added, [{ line: 5, text: line }], 'a third copy is new');
});

test('rule 9: a line copied from a pinned test into an unpinned one of the same file is named, even with --known', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-test-dates-'));
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const commit = (msg) => { sh('add', '.'); sh('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', msg); };
  const pinned = "test('a', (t) => {\n  t.mock.timers.enable({ now: 0 });\n  createStay({ startDate: '2027-07-20' });\n});\n"; // date-literal-ok: guard input
  try {
    sh('init', '-q', '-b', 'inte');
    write('server/src/tests/a.unit.test.js', pinned);
    commit('pinned test on inte');
    sh('checkout', '-qb', 'feature');
    write('server/src/tests/a.unit.test.js', `${pinned}test('b', () => {\n  createStay({ startDate: '2027-07-20' });\n});\n`); // date-literal-ok: guard input
    commit('feature');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-test-dates.mjs'), '--today', '2026-10-30', '--strict', '--base', 'inte', '--head', 'feature', '--known', 'inte'], { cwd: dir, encoding: 'utf8' }); // date-literal-ok: guard input
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /a\.unit\.test\.js:6 {2}2027-07-20/); // date-literal-ok: guard output
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 9: an integration or sync PR is not blocked by lines merged on the other branch; a new line still is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-test-dates-'));
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const commit = (msg) => { sh('add', '.'); sh('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', msg); };
  try {
    sh('init', '-q', '-b', 'master');
    write('server/src/tests/a.unit.test.js', "test('a', () => {});\n");
    commit('base');
    sh('checkout', '-qb', 'inte');
    write('server/src/tests/a.unit.test.js', "test('a', () => {});\ncreateStay({ startDate: '2027-01-24' });\n"); // date-literal-ok: guard input
    commit('merged on inte');
    sh('checkout', '-qb', 'feature');
    write('server/src/tests/a.unit.test.js', "test('a', () => {});\ncreateStay({ startDate: '2027-01-24' });\ncreateStay({ startDate: '2027-02-12' });\n"); // date-literal-ok: guard input
    commit('feature');
    const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-test-dates.mjs'), '--today', '2026-10-30', '--strict', ...args], { cwd: dir, encoding: 'utf8' }); // date-literal-ok: guard input
    const integration = run('--base', 'master', '--head', 'inte', '--known', 'master,inte');
    assert.equal(integration.status, 0, integration.stderr);
    const unknownRef = run('--base', 'master', '--head', 'inte', '--known', 'master,gone');
    assert.equal(unknownRef.status, 1, 'a known ref that does not resolve drops nothing');
    assert.match(unknownRef.stderr, /a\.unit\.test\.js:2 {2}2027-01-24/); // date-literal-ok: guard output
    const feature = run('--base', 'master', '--head', 'feature', '--known', 'master,inte');
    assert.equal(feature.status, 1);
    assert.match(feature.stderr, /a\.unit\.test\.js:3 {2}2027-02-12/); // date-literal-ok: guard output
    assert.doesNotMatch(feature.stderr, /:2 {2}/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 7: the PR job fails on a literal date in the lines it adds', () => {
  const workflow = read('.github/workflows/unit-tests.yml');
  const job = workflow.slice(workflow.indexOf('  spec-rules:'), workflow.indexOf('  server:'));
  assert.match(job, /node scripts\/check-test-dates\.mjs --base "origin\/\$\{\{ github\.base_ref \}\}" --known origin\/master,origin\/inte\/plugins --strict\n/);
});

test('rule 9: the PR job fetches the long-lived branches it checks against', () => {
  const workflow = read('.github/workflows/unit-tests.yml');
  const job = workflow.slice(workflow.indexOf('  spec-rules:'), workflow.indexOf('  server:'));
  const step = job.slice(job.indexOf('check-test-dates') - 600, job.indexOf('check-test-dates'));
  assert.match(step, /for branch in master inte\/plugins; do\n\s+git fetch --no-tags origin "\$branch"/);
});

const jobBlock = (workflow, name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

test('rule 8: the PR client suite runs in three shards, the build and the bundle budget once', () => {
  const client = jobBlock(read('.github/workflows/unit-tests.yml'), 'client');
  assert.match(client, /shard: \[1, 2, 3\]/);
  assert.match(client, /fail-fast: false/);
  assert.match(client, /npm test -- --shard=\$\{\{ matrix\.shard \}\}\/3/);
  const budget = client.slice(client.indexOf('Initial JavaScript within its budget'));
  assert.match(budget, /^[^\n]*\n\s+if: matrix\.shard == 1\n/);
});

test('specs/self-update-and-releases.md rule 52: the release runs the server suite and three client shards side by side, and packages after all of them', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.doesNotMatch(workflow, /\n {2}tests:\n/);
  const server = jobBlock(workflow, 'server-tests');
  assert.match(server, /cd server && npm test/);
  assert.doesNotMatch(server, /client/);
  const client = jobBlock(workflow, 'client-tests');
  assert.match(client, /shard: \[1, 2, 3\]/);
  assert.match(client, /npm test -- --shard=\$\{\{ matrix\.shard \}\}\/3/);
  assert.match(client, /if: matrix\.shard == 1\n\s+run: cd client && npm run build/);
  assert.match(jobBlock(workflow, 'package'), /needs: \[verify, server-tests, client-tests, e2e\]/);
});
