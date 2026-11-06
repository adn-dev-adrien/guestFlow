// specs/accounting-synthesis.md §3 rules 1, 4, 5, 7, 8, 9, 10, 13, 16, 17, 18 and 20 — the synthesis on the real
// schema, through the plugin's own routes: the same entries as the month's journal, the stays' figures of the Suivi
// financier, the tourist tax of the « Taxe de séjour » page, the comparison of the dashboard.
// specs/accountant-accounting-export.md §3 rule 38 — the CSV download stamps the last export.
// specs/plugins-phase-1-sdk.md §3 rule 40 — the finance modules the synthesis reaches through coreModule().
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const m = require('../../../tests/moneyLedgerFixture');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const loader = require('../../loader');
const sdk = require('../../sdk');
const { create: createAccountingModel } = require('../accountingModel');
const { create: createAccountingController } = require('../controller');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const { db, TODAY, inDays, pay } = m;
const finance = sdk.coreModule('financeModel').buildModel(db);
const dashboard = sdk.coreModule('financeDashboardModel').buildModel(db);

registry.reset();
registry.configure({ isActive: () => true, allows: () => true });
require('..').register(createContext('accounting-export', { db }));
const routes = registry.ensure('accounting-export').routes;
const handler = (method, path) => routes.find((r) => r.method === method && r.path === path).handlers.at(-1);

function call(method, path, query, headers = { 'sec-fetch-site': 'same-origin' }) {
  const res = {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = Buffer.from(b); return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  handler(method, path)({ query, headers }, res);
  return res;
}
const synthesis = (query) => call('get', '/api/accounting/synthesis', query);

// The month before the server's, and the one before it: whole months already over.
const firstOf = (iso) => `${iso.slice(0, 7)}-01`;
const PREV_START = firstOf(addDaysToIsoDate(firstOf(TODAY), -1));
const PREV = PREV_START.slice(0, 7);
const dayOfPrev = (d) => addDaysToIsoDate(PREV_START, d);

function stayIn(propertyId, platform, startOffset) {
  const { id } = m.fiche(propertyId, platform);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(dayOfPrev(startOffset), dayOfPrev(startOffset + 2), id);
  return id;
}

const direct = stayIn(m.WITH_ACOMPTE, 'direct', 2);
pay(direct, { depositPaid: true, depositPaidDate: dayOfPrev(0) }, { balancePaid: true, balancePaidDate: dayOfPrev(4) });
const reversed = stayIn(m.NO_ACOMPTE, m.PLATFORM.reversed, 8);
pay(reversed, { balancePaid: true, balancePaidDate: dayOfPrev(12) });
const remitted = stayIn(m.NO_ACOMPTE, m.PLATFORM.remitted, 14);
pay(remitted, { balancePaid: true, balancePaidDate: dayOfPrev(17) });
const unpaid = stayIn(m.NO_ACOMPTE, 'direct', 20);
const linked = stayIn(m.NO_ACOMPTE, 'direct', 23);
pay(linked, { balancePaid: true, balancePaidDate: dayOfPrev(25) });

const salesOf = (ym) => {
  let body = null;
  const res = { setHeader() {}, status() { return res; }, json(b) { body = b; return res; } };
  createAccountingController(createAccountingModel(db)).salesJson({ query: { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) } }, res);
  return body;
};
const cents = (v) => Math.round(Number(v || 0) * 100);

test('rules 4, 5, 10 and 18 — a month of the synthesis is the month of the journal, entry for entry', () => {
  const res = synthesis({ period: 'month', month: PREV });
  assert.equal(res.statusCode, 200);
  const data = res.body;
  const sales = salesOf(PREV);
  assert.equal(data.counts.entries, sales.totals.entriesCount);
  const vatInJournal = sales.entries.flatMap((e) => e.lines).filter((l) => l.type === 'vat').reduce((a, l) => a + cents(l.credit) - cents(l.debit), 0);
  assert.equal(cents(data.kpis.vat.amount), vatInJournal);
  assert.equal(cents(data.vatReturn.totals.vat), vatInJournal);
  const clientNet = sales.entries.filter((e) => e.direction !== 'refund').flatMap((e) => e.lines).filter((l) => l.type === 'client')
    .reduce((a, l) => a + cents(l.debit) - cents(l.credit), 0);
  assert.equal(cents(data.kpis.collected.amount), clientNet);
  assert.equal(data.kpis.collected.payments, 5, 'acompte and solde of the direct stay, two soldes, one payout');
  assert.equal(data.counts.payments, 5);
  assert.equal(data.checks.balanced.status, 'ok');
  assert.equal(data.collections.total, data.kpis.collected.amount);
  assert.equal(Math.round(data.collections.byType.reduce((a, r) => a + r.share * 10, 0)), 1000);
  const lastBucket = data.collections.series.buckets.at(-1);
  assert.equal(lastBucket.cumulative, data.kpis.collected.amount, 'the running total ends on the tile');
  assert.equal(data.collections.series.buckets.length, Number(addDaysToIsoDate(firstOf(TODAY), -1).slice(8, 10)));
});

test('rule 7 — the stays\' revenue is the Suivi financier\'s, HT and TTC', () => {
  const data = synthesis({ period: 'month', month: PREV }).body;
  const summary = finance.getSummary({ from: data.window.from, to: data.window.to, fiscalYear: data.fiscalYear.key });
  assert.equal(data.kpis.revenue.ht, summary.revenueTotalHt);
  assert.equal(data.kpis.revenue.ttc, summary.revenueTotal);
  assert.equal(data.kpis.revenue.stays, summary.reservations.length);
  assert.equal(data.kpis.revenue.source, 'stays');
});

test('rule 8 — the tourist tax to remit is the extraction\'s, month after month, and nothing on a cut month', () => {
  const data = synthesis({ period: 'month', month: PREV }).body;
  const extraction = finance.getTouristTaxExtraction({ month: PREV }).data.totals;
  assert.equal(data.kpis.touristTax.amount, extraction.taxAmount);
  assert.equal(data.kpis.touristTax.stays, extraction.reservationsCount);
  assert.ok(data.kpis.touristTax.amount > 0, 'the direct and the reversing platform\'s stays carry a tax we remit');
  const ids = finance.getTouristTaxExtraction({ month: PREV }).data.reservations.map((r) => r.reservationId);
  assert.ok(ids.includes(direct) && ids.includes(reversed) && !ids.includes(remitted));

  const quarter = `${PREV.slice(0, 4)}-Q${Math.floor((Number(PREV.slice(5, 7)) - 1) / 3) + 1}`;
  const q = synthesis({ period: 'quarter', quarter }).body;
  const months = [0, 1, 2].map((i) => `${quarter.slice(0, 4)}-${String((Number(quarter.slice(6)) - 1) * 3 + 1 + i).padStart(2, '0')}`);
  const expected = months.filter((ym) => ym <= TODAY.slice(0, 7))
    .reduce((a, ym) => a + cents(finance.getTouristTaxExtraction({ month: ym }).data.totals.taxAmount), 0);
  assert.equal(cents(q.kpis.touristTax.amount), expected);

  const cut = synthesis({ period: 'custom', from: dayOfPrev(1), to: dayOfPrev(20) }).body;
  assert.equal(cut.kpis.touristTax.amount, null);
  assert.equal(cut.kpis.touristTax.reason, 'La taxe de séjour se déclare par mois entiers.');
});

test('rule 13 — the means as the data records it: the platform\'s payout, a paid link, a mark on the fiche', () => {
  db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status, paidAt) VALUES (?, 'balance', 'https://pay.test/l', 1, 'paid', ?)")
    .run(linked, `${dayOfPrev(25)} 10:00:00`);
  const data = synthesis({ period: 'month', month: PREV }).body;
  const byMeans = Object.fromEntries(data.collections.byMeans.map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(byMeans).sort(), ['paymentLink', 'platform', 'recorded']);
  assert.equal(byMeans.platform.count, 2, 'the two platform soldes');
  assert.equal(byMeans.paymentLink.count, 1);
  assert.equal(byMeans.recorded.count, 2, 'the direct stay\'s acompte and solde');
  assert.equal(byMeans.platform.label, 'Versements plateforme');
  const byType = Object.fromEntries(data.collections.byType.map((r) => [r.key, r.count]));
  assert.deepEqual(byType, { platformPayout: 2, balance: 2, deposit: 1 });
});

test('rule 17 — a stay of the window already over that still owes money is named, with what it owes', () => {
  const data = synthesis({ period: 'month', month: PREV }).body;
  assert.equal(data.checks.settled.status, 'gap');
  assert.deepEqual(data.checks.settled.stays.map((s) => s.reservationId), [unpaid]);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(unpaid);
  assert.equal(data.checks.settled.stays[0].remaining, sdk.coreModule('reservationSettlement').remainingToPay(row));
  assert.ok(data.checks.settled.stays[0].remaining > 0);
});

test('rule 16 — the CSV download stamps the last export; the file is the same', () => {
  assert.equal(synthesis({ period: 'month', month: PREV }).body.checks.lastExport, null);
  const query = { year: PREV.slice(0, 4), month: String(Number(PREV.slice(5, 7))) };
  const first = call('get', '/api/accounting/sales.csv', query);
  assert.equal(first.statusCode, 200);
  const stamp = synthesis({ period: 'month', month: PREV }).body.checks.lastExport;
  assert.equal(stamp.month, PREV);
  assert.match(stamp.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(stamp.at.slice(0, 10), TODAY);
  const second = call('get', '/api/accounting/sales.csv', query);
  assert.deepEqual(second.body, first.body);
  assert.equal(call('get', '/api/accounting/sales.csv', { year: 'x', month: '1' }).statusCode, 400);
  assert.equal(synthesis({ period: 'month', month: PREV }).body.checks.lastExport.month, PREV, 'a refused download stamps nothing');
});

test('rule 20 — the accountant reads the synthesis, and only reads it', () => {
  const matches = (method, path) => loader.roleMatchers('accountant').some((r) => r.method === method && r.re.test(path));
  assert.equal(matches('GET', '/accounting/synthesis'), true);
  assert.equal(matches('POST', '/accounting/synthesis'), false);
});

test('rule 1 — a refused period answers 400 with its message, nothing computed', () => {
  assert.deepEqual([synthesis({ period: 'week' }).statusCode, synthesis({ period: 'week' }).body], [400, { error: 'Période inconnue.' }]);
  assert.deepEqual(synthesis({ period: 'custom', from: inDays(-800), to: inDays(-1) }).body, { error: 'Période trop longue : 750 jours au plus.' });
  assert.deepEqual(synthesis({ period: 'custom', from: '', to: inDays(-1) }).body, { error: 'Deux dates à choisir.' });
});

test('rule 9 — one comparison, the dashboard\'s: none before a year of stays, then on the same window a year earlier', () => {
  const before = synthesis({ period: 'month', month: PREV }).body;
  assert.equal(before.comparison.comparable, false);
  // The dashboard and the synthesis say the same sentence for the same window.
  const dashboardMonth = dashboard.getDashboard({ period: 'month', month: PREV, fiscalYear: before.fiscalYear.key });
  assert.equal(dashboardMonth.ok, true);
  assert.ok(before.comparison.notice, 'a sentence says why');
  assert.equal(before.comparison.notice, dashboardMonth.data.comparison.notice);
  assert.equal(before.comparison.reasonCode, dashboardMonth.data.comparison.reason);
  assert.equal(before.kpis.revenue.yoy, null);

  // A stay in the same month a year earlier: last year now exists for this month.
  const shift = (iso) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4) === '-02-29' ? '-02-28' : iso.slice(4)}`;
  const { id } = m.fiche(m.NO_ACOMPTE, 'direct');
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ?, createdAt = ? WHERE id = ?')
    .run(shift(dayOfPrev(3)), shift(dayOfPrev(5)), `${shift(dayOfPrev(0))} 09:00:00`, id);
  pay(id, { balancePaid: true, balancePaidDate: shift(dayOfPrev(5)) });

  const data = synthesis({ period: 'month', month: PREV }).body;
  const { range } = dashboard.lastYearRange({ window: { from: data.window.from, to: data.window.to }, today: TODAY });
  assert.equal(data.comparison.comparable, true);
  assert.deepEqual([data.comparison.current, data.comparison.previous], [range.current, range.previous]);
  const dashboardAfter = dashboard.getDashboard({ period: 'month', month: PREV, fiscalYear: data.fiscalYear.key }).data.comparison;
  assert.equal(data.comparison.notice, dashboardAfter.notice);
  assert.equal(data.comparison.comparable, dashboardAfter.comparable);
  const previous = finance.getSummary({ from: range.previous.from, to: range.previous.to, fiscalYear: data.fiscalYear.key });
  assert.equal(data.kpis.revenue.yoy.previous, previous.revenueTotalHt);
  assert.equal(data.kpis.collected.yoy.previous, synthesis({ period: 'custom', from: range.previous.from, to: range.previous.to }).body.kpis.collected.amount);
  assert.ok(data.kpis.collected.yoy.previous > 0);
  assert.equal(typeof data.kpis.collected.yoy.change, 'number');
  assert.equal(data.collections.series.previousAvailable, range.complete);
});
