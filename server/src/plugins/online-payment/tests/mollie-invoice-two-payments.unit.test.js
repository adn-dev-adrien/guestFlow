// specs/mollie-rolling-reserve-and-incoming-payments.md rules 16 (step 3), 33 (stabilisation loop t11 B11-1, 2026-11-17) — one document with ONE
// Qonto invoice, paid by card on two days (30 € then 20 €), and a Mollie settlement whose two payments both carry the invoice number. Before, both
// paired with the first card day's split: the second re-pointed it (`tr_d1` belonged to no split), and without « CB sur place via Mollie depuis »
// the 20 € never reached the journal. Now a split bound to another Mollie payment is never taken again: the second payment goes to the document's
// next card day of the same amount. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { salesOfDocument } = require('../../../utils/accounting/standaloneDocuments');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createSettlementsModel, syncSettlements, pairPayment } = require('../reconciliation/mollieSettlements');
const { invoiceSources } = require('../reconciliation/mollieCardSources');
const { db, TODAY, dayAt, build, reset, mollieCredit } = require('./mollieFixture');

const NUMBER = 'F-2026-900';

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

async function twoPayments({ since }) {
  const d1 = dayAt(-12);
  const d2 = dayAt(-10);
  const lines = [{ ref: 'a', vatClass: 'activities', vatRate: 10 }, { ref: 'b', vatClass: 'drinks', vatRate: 20 }];
  const payments = [
    { paidAt: d1, tenders: [{ method: 'card', amountCents: 3000 }], allocations: [{ id: 1, lineRef: 'a', amountCents: 3000, books: 1 }] },
    { paidAt: d2, tenders: [{ method: 'card', amountCents: 2000 }], allocations: [{ id: 2, lineRef: 'b', amountCents: 2000, books: 1 }] },
  ];
  const rows = salesOfDocument({ sale: { id: 7, invoiceNumber: NUMBER }, lines, payments, refunds: [], client: { firstName: 'X', lastName: 'Y' } });
  createContext('core-docs-two-payments', { db }).standaloneSales(() => rows);
  const { controller, transactions } = build({ startDate: dayAt(-60), settings: since ? { mollieCardOnSiteSince: dayAt(-30) } : {} });
  controller.syncSplits();
  // The later payment listed first: the pairing must not depend on the order Mollie lists them in.
  const mp = [
    { id: 'tr_d2', amountCents: 2000, refundedCents: 0, description: NUMBER, paidAt: `${d2}T10:00:00Z`, settlementId: 'stl_1', paymentLinkId: null },
    { id: 'tr_d1', amountCents: 3000, refundedCents: 0, description: NUMBER, paidAt: `${d1}T10:00:00Z`, settlementId: 'stl_1', paymentLinkId: null },
  ];
  const credits = [mollieCredit('c1', 4000, 7, { reference: 'REF T19274230.2611.01' })];
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  const sync = await syncSettlements({
    client: {
      getSettlement: async (reference) => ({ id: 'stl_1', reference, settledAt: `${dayAt(-7)}T08:00:00Z`, amountCents: 4000, costsCents: 0, reserveHeldCents: 1000, reserveReleasedCents: 0 }),
      listSettlementPayments: async () => mp,
    },
    model: createSettlementsModel(db), splits: createSplitsModel(db), settings: { get: () => '' }, credits, links: [], invoiceSources: invoiceSources(TODAY),
  });
  controller.syncSplits();
  const splits = db.prepare('SELECT sourceType, sourceKey, grossCents, immediateCents, reserveCents, molliePaymentId FROM mollie_payment_splits ORDER BY paidAt').all();
  const journal = controller.journal({ from: dayAt(-40), to: TODAY });
  return { sync, splits, journal, d1, d2 };
}

for (const since of [true, false]) {
  test(`B11-1 — two Mollie payments naming one invoice: two splits, each bound to its own payment, journal 30 + 20 (${since ? 'with' : 'without'} the on-site card setting)`, async () => {
    const { sync, splits, journal, d1, d2 } = await twoPayments({ since });
    assert.equal(sync.unknownPayments, 0);
    assert.deepEqual(splits, [
      { sourceType: 'invoice', sourceKey: NUMBER, grossCents: 3000, immediateCents: 2400, reserveCents: 600, molliePaymentId: 'tr_d1' },
      { sourceType: 'tender', sourceKey: `sale:standalone:7:${d2}`, grossCents: 2000, immediateCents: 1600, reserveCents: 400, molliePaymentId: 'tr_d2' },
    ]);
    assert.deepEqual(journal.entries.filter((e) => e.kind === 'link').map((e) => [e.date, e.amountCents]), [[d1, 3000], [d2, 2000]]);
    assert.equal(journal.clearing.balanceCents, 5000);
  });
}

test('B11-1 — a split already bound to another payment is never taken again: no free card day of that amount → unknown', () => {
  const owner = { sourceType: 'invoice', sourceKey: NUMBER, reservationId: null, ledgerKey: 'sale:a' };
  const bound = (id) => (source) => (source.sourceKey === NUMBER ? id : null);
  const payment = { id: 'tr_2', amountCents: 3000, description: NUMBER, paidAt: `${dayAt(-1)}T10:00:00Z` };
  assert.deepEqual(pairPayment(payment, [], new Map([[NUMBER, owner]]), bound('tr_2')), { kind: 'invoice', number: NUMBER, source: owner }, 'its own payment');
  assert.equal(pairPayment(payment, [], new Map([[NUMBER, owner]]), bound('tr_1')), null);
  const withDays = { ...owner, grossCents: 3000, paidAt: dayAt(-3), nextDays: [{ sourceType: 'tender', sourceKey: 'sale:b', reservationId: null, ledgerKey: 'sale:b', grossCents: 2000, paidAt: dayAt(-1) }] };
  assert.equal(pairPayment(payment, [], new Map([[NUMBER, withDays]]), bound('tr_1')), null, 'the next day holds another amount');
});

test('B12-1 — several card days and none of the payment amount: unknown, never the invoice day (Mollie newest-first order)', () => {
  const owner = { sourceType: 'invoice', sourceKey: NUMBER, reservationId: null, ledgerKey: 'sale:a', grossCents: 3000, paidAt: dayAt(-3),
    nextDays: [{ sourceType: 'tender', sourceKey: 'sale:b', reservationId: null, ledgerKey: 'sale:b', grossCents: 2000, paidAt: dayAt(-1) }] };
  const sources = new Map([[NUMBER, owner]]);
  const free = () => null;
  const wrong = { id: 'tr_x', amountCents: 2500, description: NUMBER, paidAt: `${dayAt(-1)}T10:00:00Z` };
  assert.equal(pairPayment(wrong, [], sources, free), null, 'wrong amount: unknown');
  const newestFirst = [{ id: 'tr_2', amountCents: 2000, description: NUMBER, paidAt: `${dayAt(-1)}T10:00:00Z` }, wrong];
  assert.equal(pairPayment(newestFirst[0], [], sources, free).source.sourceKey, 'sale:b');
  assert.equal(pairPayment(newestFirst[1], [], sources, free), null);
  const single = { ...owner, nextDays: undefined };
  assert.equal(pairPayment(wrong, [], new Map([[NUMBER, single]]), free).source.sourceKey, NUMBER, 'single-day invoice keeps the fallback');
});
