// The shaping of « À vérifier » (pure): specs/finance-data-checks.md §3 rules 2, 3 and 4.
const test = require('node:test');
const assert = require('node:assert/strict');
const shape = require('../utils/financeDataChecks');

const NNBSP = ' ';

test('rule 4: the cap keeps the first ITEM_LIMIT items and tells the rest', () => {
  const items = Array.from({ length: shape.ITEM_LIMIT + 3 }, (_, i) => ({ reservationId: i + 1 }));
  const c = shape.buildCheck('guest-name-missing', items);
  assert.equal(c.count, shape.ITEM_LIMIT + 3);
  assert.equal(c.items.length, shape.ITEM_LIMIT);
  assert.equal(c.moreCount, 3);
  assert.deepEqual(c.items[0], { reservationId: 1 });
  const empty = shape.buildCheck('guest-name-missing', []);
  assert.deepEqual([empty.count, empty.moreCount, empty.items], [0, 0, []]);
});

test('rule 2: an unknown key is a programming error, never a silent check', () => {
  assert.throws(() => shape.buildCheck('nope', []), /unknown data check/);
});

test('rule 3: fix before check before info, then the catalogue order; pendingCount counts the non-empty ones', () => {
  const built = [
    shape.buildCheck('guest-name-missing', [{}]),
    shape.buildCheck('tourist-tax-undeclared', []),
    shape.buildCheck('platform-payment-missing', [{}, {}]),
    shape.buildCheck('tourist-tax-missing', [{}]),
  ];
  const { pendingCount, checks } = shape.assemble(built);
  assert.deepEqual(checks.map((c) => c.key), ['tourist-tax-missing', 'tourist-tax-undeclared', 'platform-payment-missing', 'guest-name-missing']);
  assert.equal(pendingCount, 3);
  assert.ok(shape.CHECKS.every((c) => shape.SEVERITIES.includes(c.severity)));
});

test('rule 2: the labels a stay and a month are listed with', () => {
  const stay = { id: 7, reservationNumber: '202609011', firstName: 'Marie', lastName: 'Martin', propertyName: 'Granja', startDate: '2026-09-26', endDate: '2026-09-28' };
  assert.equal(shape.stayLabel(stay, { year: '2026' }), '202609011 · Marie Martin · Granja · 26/09 → 28/09');
  assert.equal(shape.stayLabel({ ...stay, reservationNumber: null }, { year: '2027' }), '#7 · Marie Martin · Granja · 26/09/2026 → 28/09/2026');
  assert.equal(shape.stayLabel(stay, { year: '2026', withGuest: false }), '202609011 · Granja · 26/09 → 28/09');
  assert.equal(shape.monthItemLabel('2026-09'), 'Septembre 2026');
  assert.equal(shape.undeclaredDetail(1218.15, 1), `Reste 1${NNBSP}218,15 € à déclarer · 1 séjour`);
  assert.equal(shape.undeclaredDetail(18, 2), 'Reste 18 € à déclarer · 2 séjours');
  assert.equal(shape.expectedTaxDetail(7.2), 'Taxe calculée : 7,20 €');
});
