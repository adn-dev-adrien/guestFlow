// specs/accounting-synthesis.md §3 rules 5, 6, 10, 11, 12, 13, 14, 15 and 21 — the pure engine on hand-built
// journal entries. The clock is pinned for the whole file: the dates are inputs of pure functions.
const test = require('node:test');
const assert = require('node:assert/strict');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 11, 20, 12) });

process.env.DB_PATH = ':memory:';
const {
  ventilate, vatReturn, balanceCheck, vatCheck, collectionUnits, collections, refundsOf, series, sharesOf, apportion,
} = require('../synthesis');
const { buildStructuredEntries } = require('../accountingExport');

const sale = (over = {}) => ({
  reservationId: 1, kind: 'balance', paidDate: '2026-12-03', client: { firstName: 'Anna', lastName: 'Lima' }, platform: 'direct',
  clientGrossAmount: null, finalPrice: 550, encaissementTtc: 550, encaissementNetTtc: 550, taxTtc: 0, fraction: 1,
  buckets: [{ name: 'accommodation', ht: 500, vat: 50, ratePercent: 10 }],
  ...over,
});

test('rules 5 and 6 — VAT by rate and by revenue account, from the CSV lines, both totals equal', () => {
  const items = ventilate([
    sale({ encaissementTtc: 600, encaissementNetTtc: 600, buckets: [{ name: 'accommodation', ht: 500, vat: 50, ratePercent: 10 }, { name: 'options', ht: 45.45, vat: 4.55, ratePercent: 10 }] }),
    sale({ reservationId: 2, kind: 'endOfStayComplement', encaissementTtc: 16, encaissementNetTtc: 16, buckets: [{ name: 'resources', ht: 13.33, vat: 2.67, ratePercent: 20 }] }),
    { reservationId: 3, kind: 'refund', direction: 'refund', refundId: 9, paidDate: '2026-12-05', client: { lastName: 'Retour' }, platform: 'direct',
      finalPrice: 300, encaissementTtc: 110, taxTtc: 0, buckets: [{ name: 'accommodation', ht: 100, vat: 10, ratePercent: 10 }] },
    { reservationId: 4, kind: 'tip', direction: 'tip', paidDate: '2026-12-06', client: { lastName: 'Porte' }, platform: 'direct', encaissementTtc: 5, encaissementNetTtc: 5, buckets: [], taxTtc: 0, fraction: 1 },
  ]);
  const vat = vatReturn(items);
  assert.deepEqual(vat.byRate, [
    { ratePercent: 20, base: 13.33, vat: 2.67 },
    { ratePercent: 10, base: 445.45, vat: 44.55 },
    { ratePercent: 0, base: 5, vat: 0 },
  ]);
  assert.deepEqual(vat.totals, { base: 463.78, vat: 47.22 });
  const sum = (rows, f) => Math.round(rows.reduce((a, r) => a + r[f] * 100, 0)) / 100;
  assert.equal(sum(vat.byAccount, 'vat'), vat.totals.vat);
  assert.equal(sum(vat.byAccount, 'base'), vat.totals.base);
  assert.deepEqual(vat.byAccount.map((a) => [a.account, a.label, a.ratePercent]), [
    ['70601000', 'Activité diverse', 20],
    ['70600000', 'Location gîte', 10],
    ['70600010', 'Prestation complémentaire', 10],
    ['75880000', "Indemnité d'annulation", 0],
  ]);
  // The sale's 54,55 € of VAT shared over its two accounts in proportion to 500 / 45,45 (largest remainder: 50,00 and
  // 4,55); the refund takes 10 back from the accommodation.
  assert.deepEqual(vat.byAccount.find((a) => a.account === '70600000'), { account: '70600000', label: 'Location gîte', ratePercent: 10, base: 400, vat: 40 });
  assert.equal(vat.byAccount.find((a) => a.account === '70600010').vat, 4.55);
});

test('rule 6 — the account plan renames the accounts; deductible VAT on commissions is reported apart, never netted', () => {
  const plan = { accommodationAccount: '706100', vat10Account: '445711' };
  const items = ventilate([sale({
    platform: 'CanalRev', encaissementNetTtc: 460,
    commission: { account: '62260300', hasVat: true, ttc: 90, ht: 75, vat: 15, vatAccount: '44566000', vatRate: 20 },
  })], plan);
  const vat = vatReturn(items, plan);
  assert.deepEqual(vat.byAccount, [{ account: '706100', label: 'Location gîte', ratePercent: 10, base: 500, vat: 50 }]);
  assert.equal(vat.totals.vat, 50);
  assert.equal(vat.deductibleOnCommissions, 15);
});

test('rule 11 — debits equal credits entry by entry; an unbalanced entry is named', () => {
  const items = ventilate([sale(), sale({ reservationId: 2, paidDate: '2026-12-04' })]);
  assert.deepEqual(balanceCheck(items), { status: 'ok', totalDebits: 1100, totalCredits: 1100, unbalanced: [] });
  items[1].lines[0].debit += 0.01;
  items[1].structured = { ...items[1].structured, balanced: false };
  const broken = balanceCheck(items);
  assert.equal(broken.status, 'gap');
  assert.deepEqual(broken.unbalanced.map((e) => [e.reservationId, e.gap]), [[2, 0.01]]);
});

test('rule 12 — VAT against base × rate, entry by entry and rate by rate, to the cent', () => {
  // The Lima shape booked before the TTC split (specs/accountant-accounting-export.md rule 33): 117,28 HT / 11,72 VAT, 1 cent short of 11,73.
  const legacy = sale({ reservationId: 7, kind: 'deposit', paidDate: '2026-10-04', finalPrice: 150.07, encaissementTtc: 129, encaissementNetTtc: 129, fraction: 0.859599,
    buckets: [{ name: 'accommodation', ht: 136.43, vat: 13.64, ratePercent: 10 }] });
  const exact = sale();
  const items = ventilate([legacy, exact]);
  const check = vatCheck(items);
  assert.equal(check.status, 'rounding', 'D-HC12 — one cent on an entry is a rounding gap');
  assert.deepEqual([check.gap, check.roundingCents], [0, 1]);
  assert.deepEqual(check.entries, [], 'nothing red');
  assert.equal(check.roundingEntries.length, 1);
  assert.equal(check.roundingEntries[0].rounding, true);
  assert.deepEqual(check.roundingEntries[0].rates, [{ ratePercent: 10, base: 117.28, vat: 11.72, expectedVat: 11.73, gap: -0.01 }]);
  assert.equal(check.roundingEntries[0].reservationId, 7);
  assert.equal(check.roundingEntries[0].key, 'sale:7:deposit:2026-10-04:');
  assert.deepEqual(vatCheck(ventilate([exact])), { status: 'ok', gap: 0, roundingCents: 0, entries: [], roundingEntries: [] });
  // A refund's negative base rounds the same way, half away from zero.
  const refund = { reservationId: 3, kind: 'refund', direction: 'refund', refundId: 1, paidDate: '2026-12-05', client: { lastName: 'R' }, finalPrice: 0,
    encaissementTtc: 11, taxTtc: 0, buckets: [{ name: 'accommodation', ht: 10, vat: 1, ratePercent: 10 }] };
  assert.equal(vatCheck(ventilate([refund])).status, 'ok');
  // Rate 0 lines are never judged.
  const tip = { reservationId: 4, kind: 'tip', direction: 'tip', paidDate: '2026-12-06', client: { lastName: 'P' }, encaissementTtc: 5, encaissementNetTtc: 5, buckets: [], taxTtc: 0, fraction: 1 };
  assert.equal(vatCheck(ventilate([tip])).status, 'ok');
});

test('rules 10 and 13 — an arrival payment is one payment; a rebate rides it; a penalty lowers the payouts without being one', () => {
  const group = { id: '5:2026-12-10', at: '2026-12-10', cash: false, total: 300 };
  const entries = [
    sale({ reservationId: 5, kind: 'balance', paidDate: '2026-12-10', encaissementTtc: 220, encaissementNetTtc: 220, buckets: [{ name: 'accommodation', ht: 200, vat: 20, ratePercent: 10 }], paymentGroup: group }),
    sale({ reservationId: 5, kind: 'complement', paidDate: '2026-12-10', encaissementTtc: 110, encaissementNetTtc: 110, buckets: [{ name: 'options', ht: 100, vat: 10, ratePercent: 10 }], paymentGroup: group }),
    { reservationId: 5, kind: 'discount', direction: 'discount', paidDate: '2026-12-10', client: { lastName: 'Porte' }, platform: 'direct', finalPrice: 330, taxTtc: 0, buckets: [], fraction: 1,
      encaissementTtc: 33, encaissementNetTtc: 33, discount: { account: '70900000', ttc: 33, ht: 30, vat: 3, ratePercent: 10 }, paymentGroup: group },
    sale({ reservationId: 6, platform: 'CanalRev', paidDate: '2026-12-11', encaissementNetTtc: 460,
      commission: { account: '62260300', hasVat: false, ttc: 90, ht: 90, vat: 0, vatAccount: '44566000', vatRate: 20 } }),
    { reservationId: 6, kind: 'penalty', direction: 'penalty', paidDate: '2026-12-12', client: { lastName: 'Lima' }, platform: 'CanalRev', finalPrice: 550, encaissementTtc: 20, encaissementNetTtc: 20 },
    sale({ reservationId: 8, kind: 'deposit', paidDate: '2026-12-13', encaissementTtc: 165, encaissementNetTtc: 165, buckets: [{ name: 'accommodation', ht: 150, vat: 15, ratePercent: 10 }] }),
  ];
  const means = (e) => (e.direction === 'penalty' || e.platform === 'CanalRev' ? 'platform' : (e.kind === 'deposit' ? 'paymentLink' : 'recorded'));
  const items = ventilate(entries);
  const units = collectionUnits(items, means);
  const money = collections(units);
  assert.equal(money.payments, 3, 'the group, the payout, the acompte');
  assert.equal(money.total, 297 + 440 + 165, 'the group nets its rebate, the payout its penalty');
  assert.deepEqual(money.byType.map((r) => [r.key, r.count, r.amount]), [['platformPayout', 1, 440], ['arrivalPayment', 1, 297], ['deposit', 1, 165]]);
  assert.deepEqual(money.byMeans.map((r) => [r.key, r.label, r.count, r.amount]), [
    ['platform', 'Versements plateforme', 1, 440], ['recorded', 'Marqué perçu', 1, 297], ['paymentLink', 'Lien de paiement', 1, 165],
  ]);
  assert.equal(Math.round(money.byType.reduce((a, r) => a + r.share * 10, 0)), 1000, 'shares add up to 100');
  assert.equal(Math.round(money.byType.reduce((a, r) => a + r.ratio * 1000, 0)), 1000, 'the bar\'s fractions add up to 1');
  money.byType.forEach((r) => assert.equal(r.ratio, Math.round(r.share * 10) / 1000));
  assert.deepEqual(refundsOf(items), { count: 0, amount: 0 });
});

test('rule 13 — a group whose entries came by different means reads as marked perçu', () => {
  const group = { id: 'g', at: '2026-12-10', cash: false, total: 1 };
  const items = ventilate([sale({ kind: 'deposit', paymentGroup: group }), sale({ kind: 'balance', paymentGroup: group })]);
  const units = collectionUnits(items, (e) => (e.kind === 'deposit' ? 'paymentLink' : 'recorded'));
  assert.deepEqual(units.map((u) => [u.means, u.type, u.count]), [['recorded', 'arrivalPayment', 1]]);
});

test('rule 14 — shares in tenths of a percent add up to exactly 100; none for a part that cannot be read', () => {
  assert.deepEqual(sharesOf([1, 1, 1]), [33.4, 33.3, 33.3]);
  assert.deepEqual(sharesOf([2, 1]), [66.7, 33.3]);
  assert.deepEqual(sharesOf([5]), [100]);
  assert.deepEqual(sharesOf([0, 0]), [null, null]);
  assert.deepEqual(sharesOf([10, -2]), [null, null]);
  for (const amounts of [[12345, 6789, 1, 1], [999, 1, 1, 1, 1, 1, 1], [3, 3, 3, 3, 3, 3, 3]]) {
    assert.equal(Math.round(sharesOf(amounts).reduce((a, s) => a + s * 10, 0)), 1000, String(amounts));
  }
  assert.deepEqual(apportion(-5, [1, 1]), [-2, -3]);
  assert.deepEqual(apportion(7, [0, 0]), [7, 0]);
});

test('rule 15 — running totals read up to each bucket, last year on the same buckets, nothing after today', () => {
  const units = [{ date: '2028-02-28', amount: 1000 }, { date: '2028-02-29', amount: 500 }, { date: '2028-03-02', amount: 250 }];
  const previous = [{ date: '2027-02-28', amount: 700 }, { date: '2027-03-01', amount: 100 }];
  const buckets = [
    { key: 'a', label: '28/2', from: '2028-02-28', to: '2028-02-28' },
    { key: 'b', label: '29/2', from: '2028-02-29', to: '2028-02-29' },
    { key: 'c', label: '1/3', from: '2028-03-01', to: '2028-03-01' },
    { key: 'd', label: '2/3', from: '2028-03-02', to: '2028-03-02' },
  ];
  const shiftYear = (iso, delta) => {
    const md = iso.slice(4) === '-02-29' ? '-02-28' : iso.slice(4);
    return `${Number(iso.slice(0, 4)) + delta}${md}`;
  };
  const out = series({ buckets, window: { from: '2028-02-28', to: '2028-03-02' }, today: '2028-03-01', units, previousUnits: previous, shiftYear });
  // Units are in cents (1000 = 10 €). 29 February 2028 reads 28 February 2027 a year earlier: counted once.
  assert.deepEqual(out.map((b) => [b.amount, b.cumulative, b.previousAmount, b.previousCumulative]), [
    [10, 10, 7, 7],
    [5, 15, 0, 7],
    [0, 15, 1, 8],
    [null, null, 0, 8],
  ]);
  const alone = series({ buckets, window: { from: '2028-02-28', to: '2028-03-02' }, today: '2028-03-02', units, previousUnits: null, shiftYear });
  assert.deepEqual(alone.map((b) => b.previousCumulative), [null, null, null, null]);
  assert.equal(alone[3].cumulative, 17.5);
});

test('rule 21 — amounts summed in cents never drift: 0,1 € ten times is 1 €', () => {
  const entries = Array.from({ length: 10 }, (_, i) => sale({ reservationId: 100 + i, encaissementTtc: 0.11, encaissementNetTtc: 0.11, finalPrice: 0.11,
    buckets: [{ name: 'accommodation', ht: 0.1, vat: 0.01, ratePercent: 10 }] }));
  const items = ventilate(entries);
  assert.equal(collections(collectionUnits(items, () => 'recorded')).total, 1.1);
  assert.deepEqual(vatReturn(items).totals, { base: 1, vat: 0.1 });
});

test('rule 4 — every entry keeps a reference, unique even for two notes of the same day', () => {
  const twin = (n) => ({ reservationId: 9, kind: 'midStayComplement', paidDate: '2026-12-15', client: { lastName: 'N' }, platform: 'direct', finalPrice: 10,
    encaissementTtc: 11, encaissementNetTtc: 11, taxTtc: 0, fraction: 1, buckets: [{ name: 'options', ht: 10, vat: 1, ratePercent: 10 }], n });
  const items = ventilate([twin(1), twin(2)]);
  assert.deepEqual(items.map((i) => i.ref.key), ['sale:9:midStayComplement:2026-12-15:', 'sale:9:midStayComplement:2026-12-15:#2']);
  assert.equal(items.length, buildStructuredEntries([twin(1), twin(2)]).length);
});
