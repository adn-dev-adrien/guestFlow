const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');

// Regression tests for the accounting export's handling of the tourist tax across the three flows:
//   1. Direct booking — tax baked into deposit + balance; export pro-rates against totalStayTtc.
//      The export engine's residue logic silently absorbs the tax portion.
//   2. Platform-collect (e.g. Airbnb default) — tax = 0; nothing to do, schedule is finalPrice-only.
//   3. Owner-collect non-direct (`collectsTouristTax = 0`) — tax routed to the complement bucket by
//      the pricing engine. The export must:
//        - pro-rate deposit + balance against `finalPrice` (not totalStayTtc),
//        - carve the tax portion out of the complement entry,
//        - drop the complement entry entirely if it boils down to pure tax (excluded from journal,
//          reported via Suivi taxe de séjour instead),
//        - keep emitting the residual portion when extras were added after balance was paid.
// Spec: per-platform-tourist-tax-collection.md §3 rule 7 + §4.1.

// Stay: 2 nights × 100€ = 200€ finalPrice + 4.80€ tourist tax. depositPercent = 30 %.
// Buckets pre-set so the test focuses on the entry shaping (no engine math here).
function makeRow(overrides = {}) {
  return {
    id: 7,
    firstName: 'Jean',
    lastName: 'Dupont',
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

test('owner-collect non-direct — complement that IS the tax → entry dropped (returns null)', () => {
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const c = buildEntry(row, quote, 'complement');
  assert.equal(c, null);
});

test('owner-collect non-direct — complement with tax + extras → emit ONLY the extras portion', () => {
  // Extras added after balance was paid: complement = tax (4.80) + extras (20) = 24.80.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 24.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const c = buildEntry(row, quote, 'complement');
  assert.ok(c, 'complement entry should not be dropped when revenue portion > 0');
  // Tax carved out: 24.80 − 4.80 = 20 of revenue, pro-rated against finalPrice (200) → 0.10.
  assert.equal(c.encaissementTtc, 20);
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

test('owner-collect non-direct + complement = pure tax — Σ emitted encaissements equals finalPrice', () => {
  // Without extras, deposit + balance = finalPrice and the complement (= pure tax) is dropped.
  // The accountant journal therefore covers exactly the revenue side; the tax flows to the Suivi page.
  const row = makeRow({
    platform: 'gitedefrance',
    depositAmount: 60, balanceAmount: 140,
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');
  const c = buildEntry(row, quote, 'complement');

  assert.equal(c, null);
  assert.equal(round4(dep.encaissementTtc + bal.encaissementTtc), 200);
  assert.equal(round4(dep.fraction + bal.fraction), 1);
});

function round4(n) { return Math.round(n * 10000) / 10000; }
