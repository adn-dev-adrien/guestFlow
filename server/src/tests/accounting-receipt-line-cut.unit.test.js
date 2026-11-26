// specs/pricing/pricing-components.md §3 rules 51, 61, 62, 63 — owner 2026-11-15 « Brancher quand même », read with « éviter de toucher les anciens
// séjours »: on a stay booked once 4.2.0 is installed, each receipt is allocated to its families and to the VAT classes of the stay's
// sale lines, and cut ONCE per (class, rate) group by `vatOf`; the commission's VAT is the VAT component's cut; an avoir is cut by
// `vatOf` per (bucket, rate) group. A stay booked before keeps the entry exactly as built (its months were exported with it).
const test = require('node:test');
const assert = require('node:assert/strict');

const { cutReceipt, cutRefund } = require('../utils/accounting/receiptLineCut');
const { skipWithout } = require('../plugins/sdk/testing');
const { create } = require('../utils/accounting/accountingOutput');
const { create: createJournalLines } = require('../utils/accounting/journalLines');

// The account plan is the accounting-export plugin's: the tests that write journal lines need it.
const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };
const accountPlan = () => require('../plugins/accounting-export/accountPlan');

const REGIME = { regime: 'subject', rate: 10 };
const cents = (euros) => Math.round(euros * 100);
const bucket = (name, ttc) => ({ name, ht: Math.round((ttc / 1.1) * 100) / 100, vat: Math.round((ttc - ttc / 1.1) * 100) / 100, ratePercent: 10 });

test('rule 62 — a receipt books exactly its revenue: the fraction is folded into cents, no residue for the last credit', NEEDS_PLAN, () => {
  const entry = {
    kind: 'deposit', encaissementTtc: 107.4, encaissementNetTtc: 107.4, taxTtc: 0, fraction: 0.3,
    buckets: [bucket('accommodation', 300), bucket('options', 58)], commission: null,
  };
  const cut = cutReceipt(entry, { regime: REGIME, saleLines: [] });
  assert.equal(cut.fraction, 1);
  const total = cut.buckets.reduce((sum, b) => sum + cents(b.ht) + cents(b.vat), 0);
  assert.equal(total, cents(107.4));
  const lines = createJournalLines({ accountPlan: accountPlan() }).entryLines(cut);
  const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amountCents, 0);
  assert.equal(credit, cents(107.4));
});

test('rule 61 — inside a family, the sale lines\' VAT classes share the receipt: a drink at its own rate', () => {
  const entry = { kind: 'balance', encaissementTtc: 110, taxTtc: 0, fraction: 1, buckets: [bucket('options', 110)], commission: null };
  const saleLines = [
    { kind: 'option', vatClass: 'options', totalCents: 8000 },
    { kind: 'option', vatClass: 'drinks', totalCents: 3000 },
  ];
  const regime = { regime: 'subject', rate: 10 };
  const cut = cutReceipt(entry, { regime, saleLines });
  assert.equal(cut.buckets.reduce((s, b) => s + cents(b.ht) + cents(b.vat), 0), 11000);
  assert.ok(cut.buckets.every((b) => b.name === 'options'));
});

test('rule 61 — the commission VAT is the VAT component\'s « VAT first » cut', () => {
  const entry = {
    kind: 'balance', encaissementTtc: 100, taxTtc: 0, fraction: 1, buckets: [bucket('accommodation', 100)],
    commission: { hasVat: true, ttc: 12.35, ht: 10.29, vat: 2.06, vatRate: 20 },
  };
  const cut = cutReceipt(entry, { regime: REGIME });
  assert.deepEqual([cut.commission.vat, cut.commission.ht], [2.06, 10.29]);
  const tie = cutReceipt({ ...entry, commission: { hasVat: true, ttc: 0.03, ht: 0.03, vat: 0, vatRate: 20 } }, { regime: REGIME });
  assert.equal(tie.commission.vat + tie.commission.ht, 0.03);
});

test('rule 63 — entries that are not a stay\'s sale are left as they are; an avoir is cut per (bucket, rate) group', () => {
  const discount = { direction: 'discount', kind: 'discount', encaissementTtc: 5, buckets: [] };
  assert.equal(cutReceipt(discount, { regime: REGIME }), discount);
  const avoir = { direction: 'refund', encaissementTtc: 33.33, buckets: [{ name: 'options', ht: 30.30, vat: 3.03, ratePercent: 10 }] };
  const cut = cutRefund(avoir, { regime: REGIME });
  assert.equal(cents(cut.buckets[0].ht) + cents(cut.buckets[0].vat), 3333);
  assert.equal(cut.buckets[0].vat, 3.03);
  const closing = { ...avoir, closing: [] };
  assert.equal(cutRefund(closing, { regime: REGIME }), closing);
});

test('rules 61-63 (2026-11-15) — a stay booked before 4.2.0 keeps its entries; a stay booked after cuts them over its lines', NEEDS_PLAN, () => {
  const { receiptCutOf } = create({ accountPlan: accountPlan() });
  const entry = { kind: 'deposit', encaissementTtc: 107.4, taxTtc: 0, fraction: 0.3, buckets: [bucket('accommodation', 358)], commission: null };
  let read = 0;
  const readModels = { saleLinesOf: () => { read += 1; return []; } };
  assert.equal(receiptCutOf({ id: 1, readsSaleLines: 0 }, readModels, REGIME)(entry), entry);
  assert.equal(read, 0);
  const cut = receiptCutOf({ id: 1, readsSaleLines: 1 }, readModels, REGIME);
  assert.equal(cut(entry).fraction, 1);
  cut(entry);
  assert.equal(read, 1);
});
