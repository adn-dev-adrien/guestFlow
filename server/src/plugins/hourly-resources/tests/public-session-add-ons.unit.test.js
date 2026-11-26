// specs/site/site-outside-resource-booking.md rules 34, 35, 37 (§3.H) — the website's « Ajouter à la séance » is the resource's own « Options proposées » list: the same articles in the
// operator's order, each with the shared add-on function's fields; an edit of the list changes the offer; the settings say a resource the site offers shows its list there.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');
const sdk = require('../../sdk');
const { createSessionOrdersModel } = require('../sessionOrdersModel');
const { createPublicSessionService } = require('../publicSessionService');

const suggested = sdk.coreModule('suggestedArticles');
const bath = fx.newResource({ hourlyEveningStart: '20:00' });
const hidden = fx.newResource({ name: 'Sauna caché', sellableExternally: 0 });
const board = fx.newOption({ title: 'Planche apéro' });
const juice = fx.newOption({ title: 'Jus de pomme', price: 6 });
const towels = fx.newOption({ title: 'Linge de toilette', priceType: 'per_person' });
fx.publishTerms();

const service = createPublicSessionService({
  db: fx.db,
  offer: fx.offer,
  orders: createSessionOrdersModel(fx.db, { now: () => fx.NOW }),
  terms: fx.ctx.terms,
  payments: {},
  engine: { quote: (request) => fx.standaloneSale.quote(request) },
  suggest: (resourceId) => suggested.resolve({ context: { kind: 'resource', id: resourceId }, customerContext: 'external' }),
  notify() {},
  sendMail: async () => {},
  address: () => '',
  companyName: () => 'Solio',
  basketSource: 'outsideSession',
  now: () => fx.NOW,
});
const addOns = () => service.resources().find((r) => r.id === bath).addOns;

test('rule 34 — the offer\'s add-ons are the resource\'s list, in its order; an edit of the list changes the offer; an empty list offers none', () => {
  assert.deepEqual(addOns(), []);
  assert.equal(suggested.save('resource', bath, [`option:${juice}`, `option:${board}`]).status, 200);
  assert.deepEqual(addOns().map((a) => a.articleRef), [`option:${juice}`, `option:${board}`]);
  suggested.save('resource', bath, [`option:${board}`, `option:${juice}`]);
  assert.deepEqual(addOns().map((a) => a.label), ['Planche apéro', 'Jus de pomme']);
  suggested.save('resource', bath, []);
  assert.deepEqual(addOns(), []);
});

test('rule 37 — each entry carries the shared function\'s unitLabel, linear and prices (the engine\'s, 1 … 10 at most), and maxQty is the table\'s length', () => {
  suggested.save('resource', bath, [`option:${board}`]);
  const [entry] = addOns();
  assert.deepEqual([entry.unitLabel, entry.linear, entry.maxQty], ['l’unité', true, 10]);
  assert.deepEqual(entry.prices.slice(0, 2), [{ qty: 1, cents: fx.optionCents(board) }, { qty: 2, cents: fx.optionCents(board, 2) }]);
  assert.equal(entry.prices.length, 10, 'the table stops at ten, whatever the offer allows');
});

test('rule 36 — the list never keeps an article the site could not sell: a per-person option is refused on save, so the offer never loses one silently', () => {
  suggested.save('resource', bath, []);
  assert.equal(suggested.save('resource', bath, [`option:${towels}`]).body.code, 'ARTICLE_NEEDS_STAY');
  assert.deepEqual(addOns(), []);
});

test('rule 35 — the settings say a resource the site offers shows its list there, and one it does not offer shows it at the arrival only', () => {
  const [{ contexts }] = suggested.kinds().filter((k) => k.kind === 'resource');
  assert.deepEqual(contexts.find((c) => c.id === String(bath)).shownOn, ['arrival', 'site']);
  assert.deepEqual(contexts.find((c) => c.id === String(hidden)).shownOn, ['arrival']);
});
