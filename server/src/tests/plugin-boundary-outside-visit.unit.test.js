// specs/outside-booking-sas.md rules 2-3 — the screen and the session line belong to `hourly-resources`, the visit's money to the core: with the plugin off, the
// documents it wrote stay readable (core rows: lines, payments, totals) and its `resource` suggestion context disappears; nothing in the visit's code names a
// resource or a platform.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const standaloneSale = require('../utils/standaloneSale');
const suggestedArticles = require('../utils/suggestedArticles');
const sales = require('../models/standaloneSalesModel');
const { skipWithout } = require('../plugins/sdk/testing');

const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);
sales.setExternalRate('resources', 20);

const session = {
  articleRef: 'resource:1',
  label: 'Séance',
  quantity: 1,
  unitCents: 5000,
  totalCents: 5000,
  vatClass: 'resources',
  components: [{ key: 'band:day:10:00', label: 'Jour · 10:00–11:00', detail: '1 h × 50,00 €', amountCents: 5000 }],
  fulfilmentRef: 'hourly-slot:1',
};

test('rule 2 — a visit\'s document is a core row: readable with the plugin off, its session line rendered from its snapshot', () => {
  registry.reset();
  registry.configure({ isActive: () => false, allows: () => true });
  const sold = standaloneSale.sell({
    fulfilments: [session], lines: [{ articleRef: `option:${beer}`, quantity: 1 }], originRef: 'resource-booking:1', payment: { tenders: [{ method: 'card', amountCents: 5650, internal: false }] },
  });
  assert.equal(sold.status, 200);
  const document = standaloneSale.documentOf(sold.document.document.id);
  assert.deepEqual(document.lines.map((line) => [line.kind, line.label, line.status, line.detail]), [
    ['session', 'Séance', 'paid', 'Jour · 10:00–11:00 · 1 h × 50,00 €'], ['extra', 'Bière', 'paid', '1 × 6,50 €'],
  ]);
  assert.deepEqual(document.totals, {
    totalCents: 5650, paidCents: 5650, remainingCents: 0, refundOwedCents: 0,
  });
  assert.equal(document.document.originRef, 'resource-booking:1');
});

test('rule 2 — the plugin off: its suggestion context kind is gone from the settings and the resolver', () => {
  registry.reset();
  registry.configure({ isActive: (id) => id !== 'hourly-resources', allows: () => true });
  createContext('hourly-resources', { db }).suggestionContexts({ kind: 'resource', label: 'Ressources', list: () => [{ id: '1', label: 'Une' }] });
  assert.ok(!suggestedArticles.kinds().some((kind) => kind.kind === 'resource'));
  assert.deepEqual(suggestedArticles.resolve({ context: { kind: 'resource', id: '1' }, customerContext: 'external' }), []);
  registry.reset();
});

test('rule 3 — no resource, no platform named in the code of the visit (core sale, links, plugin model, controller, invoicing)', { skip: skipWithout(['hourly-resources']) }, () => {
  const root = path.join(__dirname, '..');
  const files = [
    'utils/standaloneSale.js', 'utils/standaloneSaleLinks.js', 'utils/saleDetail.js', 'utils/pricing/steps/externalCatalogue.js', 'utils/pricing/steps/externalVat.js',
    'utils/pricing/steps/externalTotals.js', 'plugins/hourly-resources/visitModel.js', 'plugins/hourly-resources/visitController.js', 'plugins/hourly-resources/invoicing.js',
    'plugins/hourly-resources/planningCardsModel.js',
  ];
  const named = /\b(bain|nordique|sauna|jacuzzi|spa)\b|booking\.com|airbnb|abritel|g[iî]tes de france|greengo|lodgify/i;
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!named.test(code), `${file} names a resource or a platform`);
  }
});
