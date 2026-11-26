// specs/site/site-outside-resource-booking.md rule 37 (§3.H) — the one function that prices each step of an add-on sold outside a stay, shared by a voucher's add-ons and the site's session
// options: « par personne » or « l'unité », whether the table is linear, the engine's price for 1 … n, and a step the engine refuses ends the table.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAddOnPricing, unitLabelOf } = require('../utils/addOnPricing');

const OK = (cents) => ({ status: 200, refusals: [], document: { lines: [{ totalCents: cents }] } });
const types = { 'option:1': 'per_stay', 'option:2': 'per_person', 'option:3': 'per_participant_progressive', 'option:4': 'per_stay' };
// option:1 is linear (6 € a unit), option:3 a progressive table, option:4 cannot be sold beyond three units, option:5 not even one.
const engine = {
  quote: ({ lines: [{ articleRef, quantity }] }) => {
    if (articleRef === 'option:5') return { status: 200, refusals: [{ code: 'NEEDS_STAY' }], document: { lines: [] } };
    if (articleRef === 'option:4' && quantity > 3) return { status: 422, refusals: [], document: { lines: [] } };
    if (articleRef === 'option:3') return OK([0, 4000, 7000, 9000][quantity] ?? 9000);
    return OK(600 * quantity);
  },
};
const pricing = createAddOnPricing({ engine, priceTypeOf: (ref) => types[ref] });

test('rule 37 — a count is « l’unité » and linear; a per-person price is « par personne »; a progressive table is not linear; every price is the engine\'s', () => {
  assert.deepEqual(pricing.addOn('option:1', 3), { unitLabel: 'l’unité', linear: true, prices: [{ qty: 1, cents: 600 }, { qty: 2, cents: 1200 }, { qty: 3, cents: 1800 }] });
  assert.deepEqual(pricing.addOn('option:2', 1), { unitLabel: 'par personne', linear: true, prices: [{ qty: 1, cents: 600 }] });
  const progressive = pricing.addOn('option:3', 3);
  assert.deepEqual([progressive.unitLabel, progressive.linear, progressive.prices.map((p) => p.cents)], ['par personne', false, [4000, 7000, 9000]]);
});

test('rule 37 — a step the engine cannot price ends the table; an add-on with no price for one unit is left out of `priced`', () => {
  assert.deepEqual(pricing.addOn('option:4', 10).prices.map((p) => p.qty), [1, 2, 3]);
  const list = pricing.priced([
    { articleRef: 'option:1', label: 'Planche', maxQty: 2 },
    { articleRef: 'option:5', label: 'Linge', maxQty: 2 },
    { articleRef: 'option:4', label: 'Bière', maxQty: 10 },
  ]);
  assert.deepEqual(list.map((a) => [a.articleRef, a.label, a.maxQty, a.prices.length]), [['option:1', 'Planche', 2, 2], ['option:4', 'Bière', 10, 3]]);
});

test('rule 37 — without a price-type reader the catalogue\'s own row of the reference is read; an unknown reference is a count', () => {
  const defaulted = createAddOnPricing({ engine });
  assert.equal(defaulted.addOn('option:999999', 1).unitLabel, 'l’unité');
});

test('rule 37 — the unit of each price type, in the words of the price-type menu', () => {
  assert.deepEqual(['per_stay', 'per_person', 'per_participant_progressive', 'per_night', 'per_person_per_night', undefined].map(unitLabelOf),
    ['l’unité', 'par personne', 'par personne', 'par jour', 'par personne / jour', 'l’unité']);
});
