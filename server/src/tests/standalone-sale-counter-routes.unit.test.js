// specs/outside-booking-sas.md rules 11, 35-37, 39-42 (C38) — what the counter dialog and the mini SAS read: the catalogue search of the articles a caller may sell, « Ventes du jour »,
// the draft link block of a quote, the link block that comes back with a sale, and the link routes of a counter sale.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const suggested = require('../utils/suggestedArticles');
const controller = require('../controllers/standaloneSalesController');
const sales = require('../models/standaloneSalesModel');

const option = (title, price, { priceType = 'per_stay', sellable = 1, category = '' } = {}) => Number(db.prepare('INSERT INTO options (title, price, priceType, sellableExternally, vatClass, category) VALUES (?, ?, ?, ?, ?, ?)')
  .run(title, price, priceType, sellable, 'drinks', category).lastInsertRowid);
const beer = option('Bière locale', 6.5, { category: 'Boissons' });
const lemonade = option('Limonade', 4, { category: 'Boissons' });
const board = option('Planche apéritive', 14, { category: 'Restauration' });
option('Miel', 9, { sellable: 0 });
option('Petit-déjeuner', 12, { priceType: 'per_person_per_night' });
sales.setExternalRate('drinks', 20);

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });
const call = (handler, req) => { const out = res(); const result = handler({ query: {}, body: {}, params: {}, ...req }, out); return result && result.then ? result.then(() => out) : out; };
const line = (id, quantity) => ({ articleRef: `option:${id}`, quantity });

test('rule 11 — the catalogue search lists what an external caller may sell, grouped by category, and filters by a fragment of the label', () => {
  const all = suggested.catalogue({ customerContext: 'external' });
  assert.deepEqual(all.map((a) => [a.label, a.category, a.unitCents, a.max]), [
    ['Bière locale', 'Boissons', 650, 99], ['Limonade', 'Boissons', 400, 99], ['Planche apéritive', 'Restauration', 1400, 99],
  ], 'not « vendable hors séjour » and a stay-bound family are never listed');
  assert.deepEqual(suggested.catalogue({ customerContext: 'external', q: 'LIMO' }).map((a) => a.label), ['Limonade']);
  assert.deepEqual(suggested.catalogue({ customerContext: 'external', q: 'zzz' }), []);
  const out = call(require('../controllers/suggestedArticlesController').catalogue, { query: { customerContext: 'external', q: 'bi' } });
  assert.deepEqual(out.body.articles.map((a) => a.label), ['Bière locale']);
  assert.equal(call(require('../controllers/suggestedArticlesController').catalogue, { query: { customerContext: 'moon' } }).statusCode, 400);
});

test('rule 37 — the settings view names each listed article beside its reference', () => {
  suggested.kinds();
  const bath = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType, showsPlanningCard) VALUES ('Bain', 1, 30, 'per_hour', 1)").run().lastInsertRowid);
  const registry = require('../plugins/sdk/registry');
  const { createContext } = require('../plugins/sdk/createContext');
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('hourly-resources', {}).suggestionContexts({ kind: 'resource', label: 'Ressources à l’heure', list: () => [{ id: bath, label: 'Bain' }] });
  suggested.save('resource', bath, [`option:${beer}`, `option:${lemonade}`]);
  const context = suggested.settingsView().kinds.find((k) => k.kind === 'resource').contexts[0];
  assert.deepEqual(context.articles, [{ articleRef: `option:${beer}`, label: 'Bière locale' }, { articleRef: `option:${lemonade}`, label: 'Limonade' }]);
});

test('rule 39 — a quote answers the link block of the draft: no provider, no link; the sale then comes back with its own block', () => {
  const quoted = call(controller.quote, { body: { lines: [line(beer, 2)], customer: { email: 'a@exemple.fr' } } });
  assert.equal(quoted.statusCode, 200);
  assert.equal(quoted.body.document.totals.remainingCents, 1300);
  assert.equal(quoted.body.paymentLink.reason, 'PROVIDER_NOT_READY', 'no payment provider is declared here');
  const sold = call(controller.sell, { body: { lines: [line(beer, 2)], customer: { email: 'a@exemple.fr' } }, user: { email: 'admin@exemple.fr' } });
  assert.equal(sold.statusCode, 200);
  assert.equal(sold.body.document.document.status, 'due');
  assert.equal(sold.body.paymentLink.reason, 'PROVIDER_NOT_READY');
  assert.equal(sold.body.paymentLink.email, 'a@exemple.fr');
  assert.deepEqual([sold.body.sale.statusLabel, sold.body.sale.tone, sold.body.sale.lines], ['Reste 13,00 €', 'due', ['Bière locale × 2']], 'the sale comes back in the counter\'s words, the screen derives no status');
});

test('rules 39-42 — a link route refuses what it cannot do with the service\'s code, and never mails by itself', async () => {
  const sold = call(controller.sell, { body: { lines: [line(board, 1)] }, user: null }).body;
  const id = sold.document.document.id;
  const minted = await call(controller.mintLink, { params: { id }, body: { email: 'x@exemple.fr' } });
  assert.deepEqual([minted.statusCode, minted.body.code], [409, 'PROVIDER_NOT_READY']);
  assert.equal((await call(controller.mintLink, { params: { id }, body: { email: 12 } })).body.code, 'EMAIL_INVALID');
  assert.equal((await call(controller.mintLink, { params: { id: 9999 }, body: {} })).body.code, 'SALE_NOT_FOUND');
  assert.equal((await call(controller.withdrawLink, { params: { id, linkId: 1 } })).statusCode >= 400, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE saleRef IS NOT NULL").get().n, 0, 'minting and withdrawing send nothing');
});

test('« Ventes du jour » — the counter sales of the Paris day, newest first, with the counter\'s words and tone', () => {
  const paid = call(controller.sell, { body: { lines: [line(lemonade, 1)], payment: { tenders: [{ method: 'card', amountCents: 400, internal: false }], shortfall: null } }, user: null });
  assert.equal(paid.statusCode, 200);
  const offered = call(controller.sell, { body: { lines: [{ ...line(lemonade, 1), offered: true }] }, user: null });
  assert.equal(offered.statusCode, 200);
  const listed = call(controller.list, { query: {} }).body;
  const byId = (sale) => listed.sales.find((s) => s.id === sale.body.document.document.id);
  assert.deepEqual([byId(paid).statusLabel, byId(paid).tone, byId(paid).remainingCents], ['Payée', 'paid', 0]);
  assert.deepEqual([byId(offered).statusLabel, byId(offered).tone], ['Offerte', 'off']);
  assert.deepEqual(byId(offered).lines, ['Limonade × 1 (offerte)']);
  assert.ok(listed.sales.some((s) => s.statusLabel.startsWith('Reste ')), 'an unpaid sale reads « Reste … »');
  assert.ok(listed.sales[0].id > listed.sales[listed.sales.length - 1].id, 'newest first');
  assert.deepEqual(call(controller.list, { query: { day: '2001-01-01' } }).body.sales, [], 'another day lists nothing');
  assert.equal(call(controller.list, { query: { day: 'nope' } }).statusCode, 200, 'a malformed day falls back to today');
});
