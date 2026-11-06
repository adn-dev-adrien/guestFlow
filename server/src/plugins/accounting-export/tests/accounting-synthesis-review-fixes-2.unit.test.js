// specs/accounting-synthesis.md §3 rules 47, 48, 50 and 54 — verification of 2026-11-06 (V2-2, V2-3, V2-5) on the real
// schema through the plugin's routes: the series says when nothing was collected; the app's own download header
// stamps the last export where Fetch Metadata is not sent, a cross-site request never does; the tourist tax of a
// window ahead reads « Mois à venir : rien à déclarer. ». D-HC16: a repeated `fiscalYear` is a 400.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const m = require('../../../tests/moneyLedgerFixture');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const { db, TODAY, pay } = m;

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
const firstOf = (iso) => `${iso.slice(0, 7)}-01`;
const nextMonth = firstOf(addDaysToIsoDate(firstOf(TODAY), 32)).slice(0, 7);
const csvQuery = { year: TODAY.slice(0, 4), month: String(Number(TODAY.slice(5, 7))) };
const stamp = () => synthesis({ period: 'month', month: TODAY.slice(0, 7) }).body.checks.lastExport;

test('rule 47 (V2-2) — the series says the window collected nothing; one payment is enough to draw it', () => {
  assert.equal(synthesis({ period: 'month', month: nextMonth }).body.collections.series.empty, true);
  assert.equal(synthesis({ period: 'month', month: TODAY.slice(0, 7) }).body.collections.series.empty, true);
  const { id } = m.fiche(m.WITH_ACOMPTE, 'direct');
  pay(id, m.D);
  assert.equal(synthesis({ period: 'month', month: TODAY.slice(0, 7) }).body.collections.series.empty, false);
});

test('rule 48 (V2-3) — the app\'s download header stamps without Fetch Metadata; a cross-site request never stamps', () => {
  assert.equal(stamp(), null);
  call('/api/accounting/sales.csv', csvQuery, { 'x-guestflow-download': '1', 'sec-fetch-site': 'cross-site' });
  call('/api/accounting/sales.csv', csvQuery, { 'x-guestflow-download': '1', 'sec-fetch-site': 'same-site' });
  call('/api/accounting/sales.csv', csvQuery, { 'x-guestflow-download': 'yes' });
  assert.equal(stamp(), null, 'another site, or a header that is not the app\'s: nothing written');
  call('/api/accounting/sales.csv', csvQuery, { 'x-guestflow-download': '1' });
  assert.equal(stamp().month, TODAY.slice(0, 7), 'plain HTTP or an older Safari: the app\'s header stamps');
});

test('rule 50 (V2-5) — a window ahead reads « Mois à venir : rien à déclarer. »', () => {
  assert.equal(synthesis({ period: 'month', month: nextMonth }).body.kpis.touristTax.reason, 'Mois à venir : rien à déclarer.');
});

test('D-HC16 — a repeated fiscalYear is refused, never read as the current exercise', () => {
  const res = synthesis({ period: 'fy', fiscalYear: ['2026', '2027'] });
  assert.deepEqual([res.statusCode, res.body], [400, { error: 'Période inconnue.' }]);
});

test('rule 54 (D-HC16, V2R2-1) — a known key sent twice is refused whatever the kind, even one the kind does not read', () => {
  const refused = { error: 'Période inconnue.' };
  for (const query of [
    { period: 'month', month: TODAY.slice(0, 7), fiscalYear: ['2026', '2026'] },
    { month: TODAY.slice(0, 7), fiscalYear: ['2026', '2026'] },
    { period: 'quarter', quarter: `${TODAY.slice(0, 4)}-Q1`, fiscalYear: ['2026', '2026'] },
    { period: 'quarter', quarter: `${TODAY.slice(0, 4)}-Q1`, month: ['a', 'b'] },
    { period: 'custom', from: addDaysToIsoDate(TODAY, -10), to: TODAY, fiscalYear: ['2026', '2026'] },
    { period: 'custom', from: addDaysToIsoDate(TODAY, -10), to: TODAY, quarter: ['x', 'y'] },
    { period: 'fy', fiscalYear: '2026', from: ['a', 'b'] },
    { period: 'month', month: TODAY.slice(0, 7), to: ['a', 'b'] },
  ]) {
    const res = synthesis(query);
    assert.deepEqual([res.statusCode, res.body], [400, refused], JSON.stringify(query));
  }
  assert.equal(synthesis({ period: 'month', month: TODAY.slice(0, 7), fiscalYear: '2026' }).statusCode, 200, 'a single unread key stays harmless');
});
