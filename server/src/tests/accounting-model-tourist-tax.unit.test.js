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
// buildEntry signature post specs/accounting-encaissement-effective-percent.md:
// (row, kind, perLineData, commissionContext, taxContext) — the former quote is gone; the
// tax-routing flag is injected via `taxContext.collectedOnArrival`.

test('zero-amount kind returns null on BOTH paths (no phantom "tout à zéro" entry)', () => {
  // Regression for the dev-server bug Adrien spotted 2026-06-02: a reservation appeared twice
  // in the AccountingPage table (and as two journal cards) — once with real numbers, once with
  // every column at 0. Root cause: `depositDisabled = ON` after the user had clicked
  // "Marquer acompte payé" → depositPaid stayed 1, depositAmount collapsed to 0, the entry
  // was still emitted. Same shape for an accidentally-flipped complementPaid with no
  // complement amount. Both code paths must return null when the kind's amount is 0.
  const row = makeRow({ depositAmount: 0, balanceAmount: 0, complementAmount: 0 });
  const taxContext = { collectedOnArrival: false };

  // Legacy path.
  assert.equal(buildEntry(row, 'deposit', null, null, taxContext),    null);
  assert.equal(buildEntry(row, 'balance', null, null, taxContext),    null);
  assert.equal(buildEntry(row, 'complement', null, null, taxContext), null);

  // Contrib-driven path (perLineData provided).
  const perLineData = {
    hasContribs: true,
    optionLines: [], customOptionLines: [], resourceLines: [],
    accommodationTtcCurrent: 0,
  };
  assert.equal(buildEntry(row, 'deposit', perLineData, null, taxContext),    null);
  assert.equal(buildEntry(row, 'balance', perLineData, null, taxContext),    null);
  assert.equal(buildEntry(row, 'complement', perLineData, null, taxContext), null);
});

test('every entry exposes propertyName, on BOTH the contrib-driven path AND the legacy fallback', () => {
  // Regression: the propertyName field was only added to the contrib-driven return shape on
  // first pass (2026-06-02 fix). Legacy reservations (no captured contribs) fall through to
  // the second return path which was missing it — producing empty "Logement" cells in the
  // platforms-commission table on AccountingPage. Pin both code paths here.
  const row = makeRow({ propertyName: 'La Maison du Lac' });
  const taxContext = { collectedOnArrival: false };

  // Legacy path (no perLineData → hasContribs = false).
  const legacy = buildEntry(row, 'deposit', null, null, taxContext);
  assert.equal(legacy.propertyName, 'La Maison du Lac');

  // Contrib-driven path — feed a non-zero accommodation contrib so the entry isn't dropped
  // for being "all-zero" (the contrib path's null-return guard).
  const contribRow = makeRow({
    propertyName: 'La Maison du Lac',
    accommodationAcompteContribTtc: 60,
    accommodationSoldeContribTtc: 140,
  });
  const contribDriven = buildEntry(contribRow, 'deposit', {
    hasContribs: true,
    optionLines: [], customOptionLines: [], resourceLines: [],
    accommodationTtcCurrent: 200,
  }, null, taxContext);
  assert.equal(contribDriven.propertyName, 'La Maison du Lac');
});

test('direct booking (legacy path) — the tourist tax rides 100% on the solde, 0 on the acompte', () => {
  // specs/tourist-tax-on-solde.md — the acompte is the accommodation only (60), the solde carries the
  // accommodation remainder (140) + the WHOLE tax (4.80) = 144.80. The accounting must mirror that even
  // on the legacy fallback path: deposit taxTtc = 0, balance taxTtc = 4.80. Each entry stays bank-matched
  // — revenue (fraction × finalPrice) + tax = the encaissement.
  const row = makeRow({ platform: 'direct', depositAmount: 60, balanceAmount: 144.80 });
  const taxContext = { collectedOnArrival: false };

  const dep = buildEntry(row, 'deposit', null, null, taxContext);
  const bal = buildEntry(row, 'balance', null, null, taxContext);

  assert.equal(dep.taxTtc, 0, 'no tourist tax on the acompte');
  assert.equal(bal.taxTtc, 4.80, 'the whole tourist tax is on the solde');
  // Revenue fraction is now against finalPrice (the tax is booked separately on 46710000).
  assert.equal(round4(dep.fraction), 0.3);          // 60 / 200
  assert.equal(round4(bal.fraction), 0.7);          // (144.80 − 4.80) / 200 = 140 / 200
  assert.equal(dep.encaissementTtc, 60);
  assert.equal(bal.encaissementTtc, 144.80);
  // Bank-matched: revenue TTC + tax = encaissement, on each entry.
  assert.equal(round4(dep.fraction * 200 + dep.taxTtc), 60);
  assert.equal(round4(bal.fraction * 200 + bal.taxTtc), 144.80);
});

test('direct booking (contrib path) — a STALE acompte tax share is forced back onto the solde, bank-matched', () => {
  // Regression for the prod bug (THOMAS VANDEN WILDENBERG / DAMIEN NICOLET, June 2026): their acompte
  // flip happened BEFORE specs/tourist-tax-on-solde.md, so it captured a proportional tax share
  // (touristTaxAcompteContribTtc = 1.44 on a 61.44 deposit). The accounting then surfaced that tax on
  // the acompte entry. The export must now force the WHOLE tax onto the solde — 0 on the deposit — while
  // staying bank-matched (the deposit physically collected that 1.44, so it is reclassed into the
  // deposit's accommodation bucket; the balance carries the full 4.80).
  const row = makeRow({
    platform: 'direct',
    depositAmount: 61.44, balanceAmount: 143.36,
    accommodationAcompteContribTtc: 60.00, touristTaxAcompteContribTtc: 1.44,
    accommodationSoldeContribTtc: 140.00, touristTaxSoldeContribTtc: 3.36,
  });
  const taxContext = { collectedOnArrival: false };
  const perLineData = { hasContribs: true, optionLines: [], customOptionLines: [], resourceLines: [], accommodationTtcCurrent: 200 };

  const dep = buildEntry(row, 'deposit', perLineData, null, taxContext);
  const bal = buildEntry(row, 'balance', perLineData, null, taxContext);

  assert.equal(dep.taxTtc, 0, 'no tourist tax on the acompte, despite the stale capture');
  assert.equal(bal.taxTtc, 4.80, 'the WHOLE tax (not just the 3.36 captured) rides the solde');
  // Bank-matched: each entry's encaissement still equals the physically-collected échéance.
  assert.equal(dep.encaissementTtc, 61.44);
  assert.equal(bal.encaissementTtc, 143.36);
  // Σ tax across the two entries = the full stay tax, booked once, on the solde.
  assert.equal(round4(dep.taxTtc + bal.taxTtc), 4.80);
});

test('platform-collect — tax = 0, schedule is identical to a no-tax stay', () => {
  const row = makeRow({ platform: 'airbnb', touristTaxTotal: 0, depositAmount: 60, balanceAmount: 140 });
  const taxContext = { collectedOnArrival: false };

  const dep = buildEntry(row, 'deposit', null, null, taxContext);
  const bal = buildEntry(row, 'balance', null, null, taxContext);
  // 60 / 200 = 0.30, 140 / 200 = 0.70.
  assert.equal(round4(dep.fraction), 0.3);
  assert.equal(round4(bal.fraction), 0.7);
});

test('platform-reversed (case 1) — the tax is a real charge in the balance, booked on 46710000', () => {
  // The platform collects the tax then reverses it to us (single payout → balance entry, deposit=0).
  // The tax is now a REAL charge stored in `touristTaxTotal` and scheduled in the balance, so the
  // standard tax-in-balance path books it on 46710000 — no special casing.
  const row = makeRow({
    platform: 'expedia', touristTaxTotal: 4.80,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 204.80, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const taxContext = { collectedOnArrival: false };

  const bal = buildEntry(row, 'balance', null, null, taxContext);
  assert.equal(bal.taxTtc, 4.80, 'the tax is surfaced (taxTtc)');
  assert.equal(bal.encaissementTtc, 204.80, 'encaissement = stay 200 + tax 4.80');
  // A platform-remits stay (case 2) stores touristTaxTotal = 0 → no tax in the books.
  const noTax = buildEntry(makeRow({ platform: 'airbnb', touristTaxTotal: 0, depositAmount: 0, depositPaid: 0, balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-08-15' }), 'balance', null, null, taxContext);
  assert.equal(noTax.taxTtc, 0, 'platform-remits → no tax in the books');
  assert.equal(noTax.encaissementTtc, 200, 'platform-remits → encaissement is the stay only');
});

test('owner-collect non-direct — deposit + balance pro-rate against finalPrice (NOT totalStayTtc)', () => {
  const row = makeRow({ platform: 'gitedefrance', depositAmount: 60, balanceAmount: 140 });
  const taxContext = { collectedOnArrival: true };

  const dep = buildEntry(row, 'deposit', null, null, taxContext);
  const bal = buildEntry(row, 'balance', null, null, taxContext);

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
  const taxContext = { collectedOnArrival: true };

  const c = buildEntry(row, 'complement', null, null, taxContext);
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
  const taxContext = { collectedOnArrival: true };

  const c = buildEntry(row, 'complement', null, null, taxContext);
  assert.ok(c);
  // Full encaissement TTC; the tax portion rides on `46710000` in the export.
  assert.equal(c.encaissementTtc, 24.80);
  assert.equal(c.taxTtc, 4.80);
  // specs/accounting-books-the-money-collected.md rule 10 — the 20 € of extras collected at arrival are
  // credited as a PRESTATION, at their own amount. They used to be booked as a 10 % pro-rata of the
  // whole accommodation (same 20 €, but on the « location gîte » account).
  assert.equal(c.fraction, 1);
  assert.deepEqual(c.buckets.map((b) => b.name), ['options']);
  assert.equal(round2(c.buckets[0].ht + c.buckets[0].vat), 20);
});

test('direct complement (legacy options-added-late) — pure revenue, no tax (tax stays on the solde)', () => {
  // specs/tourist-tax-on-solde.md — the whole tourist tax is booked on the solde, so a direct
  // complement (extras added after the balance was paid) carries NO tax. Its 50 € are credited as a
  // prestation at their own amount (specs/accounting-books-the-money-collected.md rule 10), where the
  // former model credited the same 50 € as a 25 % pro-rata of the accommodation.
  const row = makeRow({
    platform: 'direct',
    depositAmount: 60, balanceAmount: 144.80,
    complementAmount: 50, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const taxContext = { collectedOnArrival: false };

  const c = buildEntry(row, 'complement', null, null, taxContext);
  assert.ok(c);
  assert.equal(c.encaissementTtc, 50);
  assert.equal(c.taxTtc, 0, 'the tax is on the solde, never the complement, for a direct booking');
  assert.equal(c.fraction, 1);
  assert.deepEqual(c.buckets.map((b) => b.name), ['options']);
  assert.equal(round2(c.buckets[0].ht + c.buckets[0].vat), 50);
});

test('owner-collect non-direct + complement = pure tax — Σ emitted encaissements equals totalStayTtc', () => {
  // Policy 2026-06-01: the pure-tax complement is kept; Σ encaissements now sums the full
  // amount the customer paid (revenue + tax), not just revenue.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const taxContext = { collectedOnArrival: true };

  const dep = buildEntry(row, 'deposit', null, null, taxContext);
  const bal = buildEntry(row, 'balance', null, null, taxContext);
  const c = buildEntry(row, 'complement', null, null, taxContext);

  assert.ok(c, 'pure-tax complement is kept with the new 46710000 line policy');
  assert.equal(round4(dep.encaissementTtc + bal.encaissementTtc + c.encaissementTtc), 204.80);
  assert.equal(c.taxTtc, 4.80);
});

function round4(n) { return Math.round(n * 10000) / 10000; }
function round2(n) { return Math.round(n * 100) / 100; }
