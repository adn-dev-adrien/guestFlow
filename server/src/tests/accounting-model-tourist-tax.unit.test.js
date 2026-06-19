const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');

// Regression tests for the accounting export's handling of the tourist tax across the three flows:
//   1. Direct booking — tax baked into deposit + balance; export pro-rates against totalStayTtc.
//   2. Platform-collect (e.g. Airbnb default) — tax = 0; nothing to do, schedule is finalPrice-only.
//   3. Owner-collect non-direct (`collectsTouristTax = 0`) — tax routed to the complement bucket.
//
// **Policy change 2026-06-01** (from the accountant's `Exemple export ventes SOLIO.csv`): the
// tourist tax is now surfaced on every entry via `taxTtc` and the export engine credits it on
// the `46710000` pass-through account. The entry is no longer dropped when revenue is 0 — a
// pure-tax encaissement is a valid 1-debit / 1-credit row. Tests below pin the new behaviour;
// the historical "drop pure-tax entry" cases now expect a 46710000-only entry instead.
// Spec: accountant-accounting-export.md §3.4 rule 14.

// Stay: 2 nights × 100€ = 200€ finalPrice + 4.80€ tourist tax. depositPercent = 30 %.
// Buckets pre-set so the test focuses on the entry shaping (no engine math here).
function makeRow(overrides = {}) {
  return {
    id: 7,
    firstName: 'Jean',
    lastName: 'Dupont',
    propertyName: 'Le Petit Gîte',
    finalPrice: 200,
    touristTaxTotal: 4.80,
    clientGrossAmount: null,
    platform: 'direct',
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-08-15',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    ...overrides,
  };
}
function makeQuote(overrides = {}) {
  return {
    finalPrice: 200,
    accommodationNetPrice: 181.82, accommodationVatAmount: 18.18, vatPercentageAccommodation: 10,
    optionsNetPrice: 0, optionsVatAmount: 0, vatPercentageOptions: 20,
    resourcesNetPrice: 0, resourcesVatAmount: 0, vatPercentageResources: 20,
    touristTaxCollectedOnArrival: false,
    ...overrides,
  };
}

test('zero-amount kind returns null on BOTH paths (no phantom "tout à zéro" entry)', () => {
  // Regression for the dev-server bug Adrien spotted 2026-06-02: a reservation appeared twice
  // in the AccountingPage table (and as two journal cards) — once with real numbers, once with
  // every column at 0. Root cause: `depositDisabled = ON` after the user had clicked
  // "Marquer acompte payé" → depositPaid stayed 1, depositAmount collapsed to 0, the entry
  // was still emitted. Same shape for an accidentally-flipped complementPaid with no
  // complement amount. Both code paths must return null when the kind's amount is 0.
  const row = makeRow({ depositAmount: 0, balanceAmount: 0, complementAmount: 0 });
  const quote = makeQuote();

  // Legacy path.
  assert.equal(buildEntry(row, quote, 'deposit'),    null);
  assert.equal(buildEntry(row, quote, 'balance'),    null);
  assert.equal(buildEntry(row, quote, 'complement'), null);

  // Contrib-driven path (perLineData provided).
  const perLineData = {
    hasContribs: true,
    optionLines: [], customOptionLines: [], resourceLines: [],
    accommodationTtcCurrent: 0,
  };
  assert.equal(buildEntry(row, quote, 'deposit', perLineData),    null);
  assert.equal(buildEntry(row, quote, 'balance', perLineData),    null);
  assert.equal(buildEntry(row, quote, 'complement', perLineData), null);
});

test('every entry exposes propertyName, on BOTH the contrib-driven path AND the legacy fallback', () => {
  // Regression: the propertyName field was only added to the contrib-driven return shape on
  // first pass (2026-06-02 fix). Legacy reservations (no captured contribs) fall through to
  // the second return path which was missing it — producing empty "Logement" cells in the
  // platforms-commission table on AccountingPage. Pin both code paths here.
  const row = makeRow({ propertyName: 'La Maison du Lac' });
  const quote = makeQuote();

  // Legacy path (no perLineData → hasContribs = false).
  const legacy = buildEntry(row, quote, 'deposit');
  assert.equal(legacy.propertyName, 'La Maison du Lac');

  // Contrib-driven path — feed a non-zero accommodation contrib so the entry isn't dropped
  // for being "all-zero" (the contrib path's null-return guard).
  const contribRow = makeRow({
    propertyName: 'La Maison du Lac',
    accommodationAcompteContribTtc: 60,
    accommodationSoldeContribTtc: 140,
  });
  const contribDriven = buildEntry(contribRow, quote, 'deposit', {
    hasContribs: true,
    optionLines: [], customOptionLines: [], resourceLines: [],
    accommodationTtcCurrent: 200,
  });
  assert.equal(contribDriven.propertyName, 'La Maison du Lac');
});

test('direct booking — deposit + balance pro-rate against totalStayTtc (legacy unchanged)', () => {
  const row = makeRow({ platform: 'direct', depositAmount: 61.44, balanceAmount: 143.36 });
  const quote = makeQuote();

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');

  // 61.44 / 204.80 = 0.30, 143.36 / 204.80 = 0.70. Σ fractions = 1.
  assert.equal(round4(dep.fraction), 0.3);
  assert.equal(round4(bal.fraction), 0.7);
  assert.equal(dep.encaissementTtc, 61.44);
  assert.equal(bal.encaissementTtc, 143.36);
});

test('platform-collect — tax = 0, schedule is identical to a no-tax stay', () => {
  const row = makeRow({ platform: 'airbnb', touristTaxTotal: 0, depositAmount: 60, balanceAmount: 140 });
  const quote = makeQuote({ touristTaxCollectedOnArrival: false });

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');
  // 60 / 200 = 0.30, 140 / 200 = 0.70.
  assert.equal(round4(dep.fraction), 0.3);
  assert.equal(round4(bal.fraction), 0.7);
});

test('platform-reversed (case 1) — the offered tax rides the balance as a 46710000 pass-through', () => {
  // The platform collects the tax then reverses it to us (single payout → balance entry). The tax is
  // offered on the quote (touristTaxTotal = 0) but WE remit it → it must surface in the books, ADDED
  // on top of the stay (deposit = 0 for platforms).
  const row = makeRow({
    platform: 'expedia', touristTaxTotal: 0,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const quote = makeQuote({
    touristTaxCollectedOnArrival: false,
    touristTaxOfferedByPlatform: true,
    touristTaxRemittedByOwner: true,
    touristTaxOriginalTotal: 4.80,
  });

  const bal = buildEntry(row, quote, 'balance');
  assert.equal(bal.taxTtc, 4.80, 'the reversed tax is surfaced (taxTtc)');
  assert.equal(bal.encaissementTtc, 204.80, 'encaissement = stay 200 + reversed tax 4.80');
  // A platform-remits stay (no reversal) on the same shape carries NO tax.
  const noReverse = buildEntry(row, makeQuote({ touristTaxOfferedByPlatform: true, touristTaxRemittedByOwner: false, touristTaxOriginalTotal: 4.80 }), 'balance');
  assert.equal(noReverse.taxTtc, 0, 'platform-remits → no tax in the books');
  assert.equal(noReverse.encaissementTtc, 200, 'platform-remits → encaissement is the stay only');
});

test('owner-collect non-direct — deposit + balance pro-rate against finalPrice (NOT totalStayTtc)', () => {
  const row = makeRow({ platform: 'gitedefrance', depositAmount: 60, balanceAmount: 140 });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');

  // 60 / 200 = 0.30 (vs the buggy 60 / 204.80 = 0.293).
  assert.equal(round4(dep.fraction), 0.3);
  assert.equal(round4(bal.fraction), 0.7);
  assert.equal(dep.encaissementTtc, 60);
  assert.equal(bal.encaissementTtc, 140);
});

test('owner-collect non-direct — complement that IS the tax → entry kept with taxTtc surfaced', () => {
  // Policy 2026-06-01: a pure-tax complement is no longer dropped — the tax is credited on
  // the `46710000` pass-through account by the export engine.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const c = buildEntry(row, quote, 'complement');
  assert.ok(c, 'pure-tax complement entry is kept, not dropped');
  assert.equal(c.encaissementTtc, 4.80);
  assert.equal(c.taxTtc, 4.80);
});

test('owner-collect non-direct — complement with tax + extras → emit BOTH revenue + tax pass-through', () => {
  // Extras added after balance was paid: complement = tax (4.80) + extras (20) = 24.80.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 24.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const c = buildEntry(row, quote, 'complement');
  assert.ok(c);
  // Full encaissement TTC; the tax portion rides on `46710000` in the export.
  assert.equal(c.encaissementTtc, 24.80);
  assert.equal(c.taxTtc, 4.80);
  // Revenue fraction (used for the 70xxx pro-rata in the legacy path) = 20 / finalPrice (200) = 0.10.
  assert.equal(round4(c.fraction), 0.10);
});

test('direct complement (legacy options-added-late) — unchanged, pro-rates against totalStayTtc', () => {
  const row = makeRow({
    platform: 'direct',
    depositAmount: 61.44, balanceAmount: 143.36,
    complementAmount: 50, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote();

  const c = buildEntry(row, quote, 'complement');
  assert.ok(c);
  // Direct: encaissementTtc preserved; denominator = totalStayTtc (= 204.80).
  assert.equal(c.encaissementTtc, 50);
  assert.equal(round4(c.fraction), round4(50 / 204.80));
});

test('owner-collect non-direct + complement = pure tax — Σ emitted encaissements equals totalStayTtc', () => {
  // Policy 2026-06-01: the pure-tax complement is kept; Σ encaissements now sums the full
  // amount the customer paid (revenue + tax), not just revenue.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');
  const c = buildEntry(row, quote, 'complement');

  assert.ok(c, 'pure-tax complement is kept with the new 46710000 line policy');
  assert.equal(round4(dep.encaissementTtc + bal.encaissementTtc + c.encaissementTtc), 204.80);
  assert.equal(c.taxTtc, 4.80);
});

function round4(n) { return Math.round(n * 10000) / 10000; }
