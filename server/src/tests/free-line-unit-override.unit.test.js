// specs/pricing/pricing-components.md §3 rule 94 reading S14-3 + specs/devis/devis-extras-parity-and-price-lock.md rule 13 (stabilisation loop t16, S16-1,
// 2026-11-17) — a unit override names an article (`<optionId>`) or one stored line (`line:<table>:<lineId>`), nothing else. The fiche once
// sent a free line's unit under « undefined » (a free line has no article id) and the engine, reading `optionUnitOverrides[lineKey]` with an
// undefined key, priced every option line without a stored snapshot — an option added, a quantity raised — at that free line's amount:
// the preview showed 225 € for a 120 € « Linge de toilette » the save then stored at 120 €. Same on a devis.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, beer, stay, row } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const devisModel = require('../models/devisModel');
const { storedBody } = require('../utils/stayOrderLines');

const linen = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Linge unité', 15, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(linen);

const cents = (x) => Math.round(Number(x || 0) * 100);
const call = (handler, body, params = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { resolve({ status: this.statusCode, body: p }); return this; }, set() { return this; }, setHeader() {} };
  Promise.resolve(handler({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const optionTotal = (quote, optionId) => (quote.optionLines || []).filter((l) => Number(l.optionId) === optionId).reduce((s, l) => s + cents(l.totalPrice), 0);
const storedOptionTotal = (id, optionId) => db.prepare('SELECT COALESCE(SUM(totalPrice), 0) AS t FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, optionId).t * 100;

// A stay sold with one beer, then a free « Bois » 105 € from the sale panel.
function stayWithFreeLine() {
  const id = stay(20);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), options: [{ optionId: beer, quantity: 1 }], restatePricing: true }).status, 200);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois', amount: 105 }], { now: new Date() }).status, 200);
  return id;
}

// What the fiche posts as `lockedOptionUnits`, the stray key included: the server must never read it.
const FICHE_UNITS = { [beer]: 6, undefined: 105, null: 105, 'custom:bois': 105 };

for (const [gesture, apply, optionId, expected] of [
  ['an option added', (body) => body.options.push({ optionId: linen, quantity: 1 }), linen, 1500],
  ['a quantity raised', (body) => { body.options = body.options.map((o) => (Number(o.optionId) === beer ? { ...o, quantity: 2 } : o)); }, beer, 1200],
]) {
  test(`S16-1 — stay holding a free line, ${gesture}: priced at its own unit in the preview, as the save stores it`, async () => {
    const id = stayWithFreeLine();
    const body = storedBody(id);
    apply(body);
    const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
      ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id, lockedOptionUnits: FICHE_UNITS,
    })));
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(optionTotal(preview.body, optionId), expected);
    const saved = ctrl.performUpdate(id, body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(storedOptionTotal(id, optionId), expected);
    assert.equal(cents(preview.body.finalPrice), cents(row(id).finalPrice));
  });
}

test('S16-1 — an article key is still read: an option without a stored snapshot takes the unit the fiche names for it', async () => {
  const id = stayWithFreeLine();
  const body = storedBody(id);
  body.options.push({ optionId: linen, quantity: 1 });
  const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
    ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id, lockedOptionUnits: { [linen]: 9, undefined: 105 },
  })));
  assert.equal(optionTotal(preview.body, linen), 900);
});

test('S16-1 — devis holding a free line, an option added: the devis preview prices it as the devis save stores it', async () => {
  const stayId = stay(40);
  const s = row(stayId);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(stayId);
  const base = {
    propertyId: 9701, clientId: 9701, startDate: s.startDate, endDate: s.endDate, adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct',
    checkInTime: '15:00', checkOutTime: '10:00', kind: 'devis', options: [], selectedOptions: [], resources: [], selectedResources: [],
    customOptions: [{ customKey: 'custom_1', description: 'Ménage', amount: 40, offered: false, inComplement: 0 }],
  };
  const created = devisModel.create(base);
  assert.ok(created.ok, JSON.stringify(created));
  const devisId = created.data.id;
  const loaded = devisModel.findById(devisId);
  const customOptions = loaded.options.filter((o) => o.isCustom).map((o) => ({ customKey: String(o.customOptionId), customOptionId: o.customOptionId, description: o.title, amount: o.originalTotalPrice, offered: false, inComplement: 0 }));
  const withLinen = { ...base, customOptions, options: [{ optionId: linen, quantity: 1 }], selectedOptions: [{ optionId: linen, quantity: 1 }] };
  const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({ ...withLinen, devisId, lockedOptionUnits: { undefined: 40 } })));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(optionTotal(preview.body, linen), 1500);
  const updated = devisModel.update(devisId, withLinen);
  assert.ok(updated.ok, JSON.stringify(updated));
  assert.equal(storedOptionTotal(devisId, linen), 1500);
  assert.equal(cents(preview.body.finalPrice), cents(row(devisId).finalPrice));
});
