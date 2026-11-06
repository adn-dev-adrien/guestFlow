// specs/accounting-synthesis.md §3 rules 10, 22, 35, 39 and 40 — the review of 2026-11-06 on the real schema, through
// the plugin's own routes: a cancellation that requalifies collected money moves no money (R2-1), the CSV is only
// stamped by a same-origin download (R6-5), an exercise far ahead answers at once (R2-2), the tourist tax of a window
// ahead of the server's month is « nothing yet » and a straddling window says up to when (R2-4), the VAT mention
// follows the regimes in force during the window (R2-3, D-HC13).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const m = require('../../../tests/moneyLedgerFixture');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const sdk = require('../../sdk');
const { create: createAccountingModel } = require('../accountingModel');
const { create: createAccountingController } = require('../controller');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const { db, TODAY, pay } = m;
const finance = sdk.coreModule('financeModel').buildModel(db);

registry.reset();
registry.configure({ isActive: () => true, allows: () => true });
require('..').register(createContext('accounting-export', { db }));
const routes = registry.ensure('accounting-export').routes;
const handler = (path) => routes.find((r) => r.method === 'get' && r.path === path).handlers.at(-1);

function call(path, query, headers = {}) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = Buffer.from(b); return this; },
    setHeader() {},
  };
  handler(path)({ query, headers }, res);
  return res;
}
const synthesis = (query) => call('/api/accounting/synthesis', query);
const thisMonth = () => synthesis({ period: 'month', month: TODAY.slice(0, 7) }).body;
const cents = (v) => Math.round(Number(v || 0) * 100);
const journalVat = (ym) => {
  let body = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { body = b; return res; } };
  createAccountingController(createAccountingModel(db)).salesJson({ query: { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) } }, res);
  return body.entries.flatMap((e) => e.lines).filter((l) => l.type === 'vat').reduce((a, l) => a + cents(l.credit) - cents(l.debit), 0);
};
const collectedView = (d) => ({
  amount: d.kpis.collected.amount,
  payments: d.counts.payments,
  refunds: d.kpis.collected.refunds,
  means: d.collections.byMeans.map((r) => [r.key, r.count, r.amount]),
  types: d.collections.byType.map((r) => [r.key, r.count, r.amount]),
  last: d.collections.series.buckets.filter((b) => b.cumulative != null).at(-1).cumulative,
});

test('rule 10 (R2-1) — a cancellation that keeps a paid acompte moves no money: collected, payments, means, types, refunds unchanged', async () => {
  const { id } = m.fiche(m.WITH_ACOMPTE, 'direct');
  pay(id, m.D);
  const before = collectedView(thisMonth());
  assert.ok(before.amount > 0);
  await m.cancel(id);
  const after = thisMonth();
  assert.deepEqual(collectedView(after), before);
  assert.ok(!after.collections.byType.some((r) => r.key === 'compensation'), 'no indemnity row for a retained acompte');
  assert.equal(cents(after.kpis.vat.amount), journalVat(TODAY.slice(0, 7)), 'the VAT still reads the journal, avoir included');
  assert.equal(after.checks.balanced.status, 'ok');
});

test('rule 10 (R2-1) — the same on a platform stay: the requalified pair never reaches the payouts nor the refunds', () => {
  // A platform stay is cancelled from the iCal alert, not from this fixture's route: its retained pair is built as
  // the export builds it (an avoir `retained`, a compensation `retained_deposit` carrying the platform).
  const { ventilate, collectionUnits, collections, refundsOf } = require('../synthesis');
  const day = TODAY;
  const payout = {
    reservationId: 9, kind: 'balance', paidDate: day, client: { lastName: 'Ota' }, platform: m.PLATFORM.reversed, clientGrossAmount: null,
    finalPrice: 600, encaissementTtc: 600, encaissementNetTtc: 600, taxTtc: 0, fraction: 1, buckets: [{ name: 'accommodation', ht: 545.45, vat: 54.55, ratePercent: 10 }],
  };
  const avoir = {
    reservationId: 9, kind: 'refund', direction: 'refund', method: 'retained', refundId: 3, paidDate: day, client: { lastName: 'Ota' }, platform: m.PLATFORM.reversed,
    finalPrice: 600, encaissementTtc: 600, taxTtc: 0, buckets: [{ name: 'accommodation', ht: 545.45, vat: 54.55, ratePercent: 10 }],
  };
  const kept = {
    compensationId: 4, reservationId: 9, kind: 'compensation', direction: 'compensation', origin: 'retained_deposit', paidDate: day,
    client: { lastName: 'Ota' }, platform: m.PLATFORM.reversed, finalPrice: 600, encaissementTtc: 600, encaissementNetTtc: 600, taxTtc: 0, fraction: 1, buckets: [],
    compensation: { account: '75880000', ht: 600, vat: 0, ratePercent: 0 },
  };
  const means = (e) => (e.platform === m.PLATFORM.reversed ? 'platform' : 'recorded');
  const before = collections(collectionUnits(ventilate([payout]), means));
  const items = ventilate([payout, avoir, kept]);
  const after = collections(collectionUnits(items, means));
  assert.deepEqual(after, before);
  assert.deepEqual(refundsOf(items), { count: 0, amount: 0 });
  const wired = { ...kept, compensationId: 5, origin: 'platform' };
  assert.equal(collections(collectionUnits(ventilate([wired]), means)).payments, 1, 'an indemnity a platform wires is new money');
});

test('rule 40 (R6-5) — only a same-origin download stamps the last export', () => {
  const query = { year: TODAY.slice(0, 4), month: String(Number(TODAY.slice(5, 7))) };
  const before = thisMonth().checks.lastExport;
  assert.equal(call('/api/accounting/sales.csv', query).statusCode, 200);
  assert.equal(call('/api/accounting/sales.csv', query, { 'sec-fetch-site': 'cross-site' }).statusCode, 200);
  assert.equal(call('/api/accounting/sales.csv', query, { 'sec-fetch-site': 'none' }).statusCode, 200);
  assert.deepEqual(thisMonth().checks.lastExport, before, 'no header, another site or a typed address: nothing written');
  call('/api/accounting/sales.csv', query, { 'sec-fetch-site': 'same-origin' });
  assert.equal(thisMonth().checks.lastExport.month, TODAY.slice(0, 7));
});

test('rule 22 (R2-2) — an exercise far ahead on the real model answers at once, its options bounded', () => {
  const started = Date.now();
  const res = synthesis({ period: 'fy', fiscalYear: '9999' });
  assert.equal(res.statusCode, 200);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.ok(JSON.stringify(res.body).length < 60000);
  assert.ok(res.body.periodOptions.months.length <= 121);
});

const firstOf = (iso) => `${iso.slice(0, 7)}-01`;
const nextMonthStart = addDaysToIsoDate(firstOf(addDaysToIsoDate(firstOf(TODAY), 32)), 0);
const quarterOf = (iso) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

test('rule 39 (R2-4) — a window after the server\'s month has nothing to declare yet; a straddling one says up to when', () => {
  const ahead = synthesis({ period: 'month', month: nextMonthStart.slice(0, 7) }).body.kpis.touristTax;
  assert.deepEqual([ahead.amount, ahead.stays, ahead.reason], [null, null, 'Rien à déclarer avant le mois en cours.']);
  assert.equal(ahead.yoy, null);
  const now = synthesis({ period: 'quarter', quarter: quarterOf(TODAY) }).body.kpis.touristTax;
  const lastMonthOfQuarter = Number(quarterOf(TODAY).slice(6)) * 3;
  if (Number(TODAY.slice(5, 7)) < lastMonthOfQuarter) {
    assert.ok(now.until, 'the current quarter is summed up to the server\'s month, and says so');
  } else {
    assert.equal(now.until, null);
  }
  // One read of the shared rows equals the monthly extractions it replaces (R6-11).
  const months = Array.from({ length: 3 }, (_, i) => `${quarterOf(TODAY).slice(0, 4)}-${String((Number(quarterOf(TODAY).slice(6)) - 1) * 3 + 1 + i).padStart(2, '0')}`)
    .filter((ym) => ym <= TODAY.slice(0, 7));
  const monthly = months.reduce((a, ym) => a + cents(finance.getTouristTaxExtraction({ month: ym }).data.totals.taxAmount), 0);
  assert.equal(cents(now.amount), monthly);
});

test('rule 35 (R2-3, D-HC13) — the VAT mention follows the regimes in force during the window, not today\'s', () => {
  const old = synthesis({ period: 'month', month: firstOf(addDaysToIsoDate(firstOf(TODAY), -100)).slice(0, 7) }).body;
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES ('not_subject', 0, 'art_261_d_4', 'arrival', ?)").run(nextMonthStart);
  const past = synthesis({ period: 'month', month: firstOf(addDaysToIsoDate(firstOf(TODAY), -100)).slice(0, 7) }).body.kpis.vat;
  assert.deepEqual([past.amount, past.notSubject], [old.kpis.vat.amount, null], 'a past window that was subject keeps its amount, a nil return included');
  const ahead = synthesis({ period: 'month', month: nextMonthStart.slice(0, 7) }).body.kpis.vat;
  assert.deepEqual([ahead.amount, ahead.notSubject && ahead.notSubject.label], [null, 'Exonération de TVA']);
  const straddling = synthesis({ period: 'custom', from: firstOf(TODAY), to: addDaysToIsoDate(nextMonthStart, 10) }).body.kpis.vat;
  assert.equal(straddling.notSubject, null, 'subject for part of the window: the amount is shown');
  assert.equal(typeof straddling.amount, 'number');
});

// ── The pure engine's share of the review (rules 3, 36, 37, 38) ─────────────────────────────────────────────
const { ventilate, vatReturn, vatCheck, collectionUnits, collections } = require('../synthesis');
const { buildRows } = require('../accountingExport');

const saleOf = (over = {}) => ({
  reservationId: 1, kind: 'balance', paidDate: TODAY, client: { lastName: 'Lima' }, platform: 'direct', clientGrossAmount: null,
  finalPrice: 110, encaissementTtc: 110, encaissementNetTtc: 110, taxTtc: 0, fraction: 1,
  buckets: [{ name: 'accommodation', ht: 100, vat: 10, ratePercent: 10 }], ...over,
});

test('rule 3 (R2-1) — the origin a compensation now carries changes no CSV byte', () => {
  const compensation = {
    compensationId: 7, reservationId: 2, kind: 'compensation', direction: 'compensation', paidDate: TODAY, client: { lastName: 'K' }, platform: '',
    finalPrice: 50, encaissementTtc: 50, encaissementNetTtc: 50, taxTtc: 0, fraction: 1, buckets: [], compensation: { account: '75880000', ht: 50, vat: 0, ratePercent: 0 },
  };
  assert.deepEqual(buildRows([{ ...compensation, origin: 'retained_deposit' }]), buildRows([compensation]));
});

test('rule 36 (R2-9) — an account shared by tips and indemnities is « Produits divers » in the VAT return by account', () => {
  const tip = { reservationId: 3, kind: 'tip', direction: 'tip', paidDate: TODAY, client: { lastName: 'P' }, platform: 'direct', finalPrice: 0,
    encaissementTtc: 5, encaissementNetTtc: 5, taxTtc: 0, fraction: 1, buckets: [], tipAccount: '75880000', accountLabels: { 75880000: 'Pourboire' } };
  const indemnity = { compensationId: 8, reservationId: 4, kind: 'compensation', direction: 'compensation', paidDate: TODAY, client: { lastName: 'I' }, platform: '',
    finalPrice: 40, encaissementTtc: 40, encaissementNetTtc: 40, taxTtc: 0, fraction: 1, buckets: [], compensation: { account: '75880000', ht: 40, vat: 0, ratePercent: 0 } };
  const label = (entries) => vatReturn(ventilate(entries)).byAccount.find((a) => a.account === '75880000').label;
  assert.equal(label([tip]), 'Pourboire', 'one use: its own name');
  assert.equal(label([indemnity]), "Indemnité d'annulation");
  assert.equal(label([tip, indemnity]), 'Produits divers');
});

test('rule 37 (R2-7) — beyond five rows a breakdown folds its tail into « Autres », shares still 100', () => {
  const kinds = ['deposit', 'balance', 'installment', 'complement', 'endOfStayComplement', 'midStayComplement'];
  const entries = kinds.map((kind, i) => saleOf({ reservationId: 20 + i, kind, encaissementTtc: 110 + i, encaissementNetTtc: 110 + i, finalPrice: 110 + i }));
  const { byType } = collections(collectionUnits(ventilate(entries), () => 'recorded'));
  assert.equal(byType.length, 5);
  const other = byType.at(-1);
  assert.deepEqual([other.key, other.label, other.count], ['other', 'Autres', 2]);
  assert.equal(other.parts.length, 2);
  assert.equal(Math.round(byType.reduce((a, r) => a + r.share * 10, 0)), 1000);
  assert.equal(new Set(byType.map((r) => r.key)).size, 5);
});

test('rule 38 (D-HC12) — two cents or more on one entry is a gap, listed red; one cent stays rounding', () => {
  const off = saleOf({ buckets: [{ name: 'accommodation', ht: 100, vat: 10.02, ratePercent: 10 }], encaissementTtc: 110.02, encaissementNetTtc: 110.02 });
  const cent = saleOf({ reservationId: 2, buckets: [{ name: 'accommodation', ht: 100, vat: 10.01, ratePercent: 10 }], encaissementTtc: 110.01, encaissementNetTtc: 110.01 });
  const check = vatCheck(ventilate([off, cent]));
  assert.equal(check.status, 'gap');
  assert.deepEqual([check.gap, check.roundingCents], [0.02, 1]);
  assert.deepEqual(check.entries.map((e) => [e.reservationId, e.rounding]), [[1, false]], 'red: the gap beyond rounding');
  assert.deepEqual(check.roundingEntries.map((e) => e.reservationId), [2]);
  assert.equal(vatCheck(ventilate([cent])).status, 'rounding');
});
