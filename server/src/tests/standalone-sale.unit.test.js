// specs/pricing-components.md §3 rules 53, 74, 52 and specs/outside-booking-sas.md rules 10-19, 21-26 — the external sale core: the `externalSale`
// pipeline, the frozen lines of a standalone document, SETTLEMENT's remaining amount and allocation, the refusals, « Offrir », the paid-line confirmation.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const sales = require('../models/standaloneSalesModel');
const { externalSale } = require('../utils/pricing/pipelines');

const option = (title, price, extra = {}) => Number(db.prepare(`INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, ?, ?, ?)`)
  .run(title, price, extra.priceType || 'per_stay', extra.sellable === false ? 0 : 1, extra.vatClass === undefined ? 'drinks' : extra.vatClass).lastInsertRowid);
const beer = option('Bière locale', 6.5);
const lemonade = option('Limonade', 4);
const board = option('Planche', 14, { vatClass: 'catering' });
const night = option('Petit-déjeuner', 12, { priceType: 'per_person_per_night' });
const hidden = option('Miel', 9, { sellable: false });
const noRate = option('Carte postale', 2, { vatClass: 'options' });
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);

const line = (id, quantity, extra = {}) => ({ articleRef: `option:${id}`, quantity, ...extra });
const sell = (lines, extra = {}) => standaloneSale.sell({ lines, ...extra });

test('rule 52 — externalSale is a pipeline of its own: the steps are chained, a missing input fails at build time', () => {
  assert.deepEqual([...externalSale.steps], ['loadCatalogue', 'externalExtras', 'externalVat', 'externalTotals', 'externalPayment']);
});

test('rule 53 — a quote prices the lines at the external rate of their class, writes nothing and offers the document shape', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n;
  const result = standaloneSale.quote({ lines: [line(beer, 3), line(board, 1)] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.refusals, []);
  assert.equal(result.document.totals.totalCents, 3 * 650 + 1400);
  assert.equal(result.document.totals.remainingCents, 3 * 650 + 1400);
  assert.deepEqual(result.document.lines.map((l) => [l.label, l.quantity, l.unitCents, l.totalCents, l.vatRate, l.status]), [
    ['Bière locale', 3, 650, 1950, 20, 'due'], ['Planche', 1, 1400, 1400, 10, 'due'],
  ]);
  assert.deepEqual(result.document.vatByRate.map((r) => r.rate), [10, 20]);
  assert.equal(result.document.vatByRate.find((r) => r.rate === 20).vatCents, 325, 'VAT rounded once per group: 1 950 × 20 / 120');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n, before, 'a quote writes nothing');
});

test('rule 53 — only what is « vendable hors séjour » and needs no stay is sold; a family that reads the stay answers NEEDS_STAY', () => {
  const result = standaloneSale.quote({ lines: [line(hidden, 1), line(night, 2), line(9999, 1)] });
  assert.deepEqual(result.refusals.map((r) => r.code).sort(), ['ARTICLE_UNKNOWN', 'NEEDS_STAY', 'NOT_SELLABLE']);
  const direct = require('../utils/pricing/articles');
  const family = direct.liveFamilies().perPersonPerNight;
  assert.equal(family.validate({}, { quantity: 1 }, { customerContext: 'external', persons: 2, nights: 1 })[0].code, 'NEEDS_STAY', 'the family itself refuses');
  assert.deepEqual(family.validate({}, { quantity: 1 }, { persons: 2, nights: 1 }), [], 'and still prices a stay');
});

test('rule 12 — quantity bounds: 1 to 99, a whole number', () => {
  for (const quantity of [0, 100, 1.5, -2]) {
    assert.equal(standaloneSale.quote({ lines: [line(beer, quantity)] }).refusals[0].message, 'Quantité : 1 à 99.');
  }
});

test('rule 53 — a class with no external rate is refused, never priced at a guess', () => {
  const result = standaloneSale.quote({ lines: [line(noRate, 1)] });
  assert.equal(result.refusals[0].code, 'VAT_RATE_UNKNOWN');
  assert.equal(sell([line(noRate, 1)]).status, 400);
});

test('rule 74 — a sale freezes its lines: label, quantity, unit, total, VAT class and rate; a later price or rate change moves nothing', () => {
  const result = sell([line(beer, 2)]);
  assert.equal(result.status, 200);
  const { id } = result.document.document;
  db.prepare('UPDATE options SET price = 99, title = ? WHERE id = ?').run('Autre', beer);
  sales.setExternalRate('drinks', 5);
  const again = standaloneSale.documentOf(id);
  assert.deepEqual(again.lines.map((l) => [l.label, l.unitCents, l.totalCents, l.vatClass, l.vatRate]), [['Bière locale', 650, 1300, 'drinks', 20]]);
  assert.equal(again.vatByRate[0].vatCents, 217);
  db.prepare('UPDATE options SET price = 6.5, title = ? WHERE id = ?').run('Bière locale', beer);
  sales.setExternalRate('drinks', 20);
});

test('rule 13 — more of the same article is a line of its own; the document groups them for display', () => {
  const first = sell([line(lemonade, 1)]);
  const { id, version } = first.document.document;
  const second = sell([line(lemonade, 2)], { saleId: id, version });
  assert.equal(second.status, 200);
  assert.equal(second.document.lines.length, 2);
  assert.equal(second.document.groups.length, 1);
  assert.match(second.document.groups[0].title, /Limonade — 3 × 4,00 € \(2 lignes\)/);
});

test('rule 21 — the document version is compared: a second device sells on a stale version and is told the price moved', () => {
  const first = sell([line(lemonade, 1)]);
  const { id, version } = first.document.document;
  assert.equal(sell([line(lemonade, 1)], { saleId: id, version }).status, 200);
  const stale = sell([line(lemonade, 1)], { saleId: id, version });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'PRICE_CHANGED');
  assert.equal(stale.body.error, 'Prix modifié — relire le panier');
  assert.equal(sell([line(lemonade, 1)], { acceptedTotalCents: 1 }).body.code, 'PRICE_CHANGED', 'quote = commit');
});

test('rules 14, 15 — « Offrir » sets the line to 0 and keeps its catalogue value struck; the remaining amount follows', () => {
  const sold = sell([line(beer, 2), line(lemonade, 1)]);
  const { id, version } = sold.document.document;
  const [beerLine] = sold.document.lines;
  const offered = standaloneSale.offerLine(id, beerLine.id, { offered: true, version });
  assert.equal(offered.status, 200);
  const row = offered.document.lines[0];
  assert.deepEqual([row.offered, row.totalCents, row.catalogueCents, row.status], [true, 0, 1300, 'offered']);
  assert.equal(offered.document.totals.totalCents, 400);
  const back = standaloneSale.offerLine(id, beerLine.id, { offered: false });
  assert.equal(back.document.totals.totalCents, 1700, 'the catalogue value comes back');
  assert.equal(standaloneSale.offerLine(id, beerLine.id, { offered: true, version: 0 }).body.code, 'PRICE_CHANGED');
});

test('edge — everything offered is a 0 € document: nothing to collect, no remaining amount', () => {
  const result = sell([line(beer, 1, { offered: true })]);
  assert.equal(result.status, 200);
  assert.equal(result.document.totals.totalCents, 0);
  assert.equal(result.document.document.status, 'paid');
  assert.equal(result.document.totals.remainingCents, 0);
});

test('rule 16-19 — a partial payment needs the shortfall « due », is filed on the lines in sale order, and the next payment is on the reste only', () => {
  const sold = sell([line(beer, 2), line(lemonade, 1)]);
  const { id } = sold.document.document;
  const short = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 1000 }] });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /ne sont pas couverts/);
  const waived = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 1000 }], shortfall: { kind: 'waived' } });
  assert.equal(waived.body.error, 'Geste commercial : offrir une ligne.');
  const paid = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 1000 }], shortfall: { kind: 'due' } });
  assert.equal(paid.status, 200);
  assert.deepEqual([paid.document.totals.paidCents, paid.document.totals.remainingCents], [1000, 700]);
  assert.deepEqual(paid.document.lines.map((l) => [l.status, l.settledCents]), [['due', 1000], ['due', 0]], 'the first line is covered first, partly');
  const over = standaloneSale.pay(id, { tenders: [{ method: 'card', amountCents: 9000 }] });
  assert.equal(over.body.error, 'Les moyens font 90,00 € pour 7,00 € dus.');
  const rest = standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 700 }] });
  assert.deepEqual([rest.document.totals.remainingCents, rest.document.document.status], [0, 'paid']);
  assert.deepEqual(rest.document.lines.map((l) => l.status), ['paid', 'paid']);
  assert.equal(standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 100 }] }).body.error, 'Rien à encaisser.');
});

test('rule 16 — the caisse interne part of a cash tender is allocated off the books', () => {
  const sold = sell([line(beer, 1)], { payment: { tenders: [{ method: 'cash', amountCents: 500, internal: true }, { method: 'card', amountCents: 150 }] } });
  assert.equal(sold.status, 200);
  const rows = db.prepare('SELECT paymentRef, amountCents, books FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(`standalone:${sold.document.document.id}`);
  assert.deepEqual(rows.map((r) => [r.amountCents, r.books]), [[150, 1], [500, 0]]);
  assert.match(rows[1].paymentRef, /:internal$/);
});

test('rule 25 — lowering a paid line is refused without the confirmation; confirmed, the money taken is owed back', () => {
  const sold = sell([line(beer, 2), line(lemonade, 1)], { payment: { tenders: [{ method: 'card', amountCents: 1700 }] } });
  const { id } = sold.document.document;
  const [beerLine] = sold.document.lines;
  const refused = standaloneSale.offerLine(id, beerLine.id, { offered: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'LINE_PAID');
  assert.equal(refused.body.error, 'Ligne payée : remboursement à confirmer.');
  const confirmed = standaloneSale.offerLine(id, beerLine.id, { offered: true, confirmRefund: true });
  assert.equal(confirmed.document.totals.refundOwedCents, 1300);
  assert.equal(confirmed.document.totals.remainingCents, 0);
  const removed = standaloneSale.removeLine(id, sold.document.lines[1].id, { confirmRefund: true });
  assert.equal(removed.document.totals.refundOwedCents, 1700);
});

test('an unpaid line is removed freely and no longer counts', () => {
  const sold = sell([line(beer, 1), line(lemonade, 1)]);
  const { id } = sold.document.document;
  const removed = standaloneSale.removeLine(id, sold.document.lines[0].id);
  assert.equal(removed.status, 200);
  assert.equal(removed.document.totals.totalCents, 400);
  assert.equal(removed.document.lines[0].status, 'cancelled');
  assert.equal(standaloneSale.removeLine(id, sold.document.lines[0].id).status, 404);
});

test('rule 26 — cancelling a document cancels its lines, keeps the money taken as owed back and refuses further sales', () => {
  const sold = sell([line(beer, 1)], { payment: { tenders: [{ method: 'card', amountCents: 650 }] } });
  const { id } = sold.document.document;
  const cancelled = standaloneSale.cancel(id);
  assert.equal(cancelled.document.document.status, 'cancelled');
  assert.equal(cancelled.document.totals.refundOwedCents, 650);
  assert.equal(sell([line(beer, 1)], { saleId: id }).body.code, 'SALE_CANCELLED');
});

test('rule 55 — a committed sale publishes standaloneSale.sold, a refused one publishes nothing', async () => {
  const registry = require('../plugins/sdk/registry');
  const { createContext } = require('../plugins/sdk/createContext');
  const { EVENTS } = require('../plugins/sdk/eventBus');
  assert.ok(EVENTS.includes('standaloneSale.sold'));
  registry.configure({ isActive: () => true, allows: () => true });
  const seen = [];
  createContext('observer-standalone', {}).events.on('standaloneSale.sold', (payload) => { seen.push(payload); });
  const settle = () => new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });
  await settle();
  seen.length = 0;
  sell([line(hidden, 1)]);
  await settle();
  assert.equal(seen.length, 0);
  const sold = sell([line(beer, 1)]);
  await settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].saleId, sold.document.document.id);
  assert.deepEqual(seen[0].lines.map((l) => l.totalCents), [650]);
});
