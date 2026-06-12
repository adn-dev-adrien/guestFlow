// Bed-linen adequacy flag for the planning arrival cards.
// See specs/planning-arrival-alerts.md §3 rule 6.

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeBedLinenAlert } = require('../utils/bedLinenAdequacy');

const LINEN = { autoOptionType: 'bed_linen', title: 'Linge de lit' };
const OTHER = { autoOptionType: 'cleaning', title: 'Ménage' };

test('linen-by-default property → never alerts (even with no option / a mismatch)', () => {
  assert.equal(computeBedLinenAlert({
    reservation: { adults: 4, singleBeds: 0, doubleBeds: 0 },
    options: [],
    bedLinenProvidedByDefault: true,
  }), null);
});

test('no bed-linen option (and not default) → no_linen alert', () => {
  assert.deepEqual(computeBedLinenAlert({
    reservation: { adults: 2, doubleBeds: 0, singleBeds: 0 },
    options: [OTHER],
    bedLinenProvidedByDefault: false,
  }), { type: 'no_linen' });
});

test('linen taken + beds cover the guests → no alert', () => {
  // 2 adults, 1 double bed = capacity 2 ≥ required 2.
  assert.equal(computeBedLinenAlert({
    reservation: { adults: 2, teens: 0, children: 0, babies: 0, doubleBeds: 1, singleBeds: 0, babyBeds: 0 },
    options: [LINEN],
    bedLinenProvidedByDefault: false,
  }), null);
});

test('linen taken + beds insufficient → capacity alert with numbers', () => {
  // 4 adults; 1 double (cap 2) + 1 single (cap 1) = 3 < 4.
  assert.deepEqual(computeBedLinenAlert({
    reservation: { adults: 4, teens: 0, children: 0, babies: 0, doubleBeds: 1, singleBeds: 1, babyBeds: 0 },
    options: [LINEN],
    bedLinenProvidedByDefault: false,
  }), { type: 'capacity', capacity: 3, required: 4 });
});

test('children sleeping in a baby bed are deducted from the required regular beds', () => {
  // 2 adults + 1 child, but 1 baby bed (no babies) hosts the child → required = 2, capacity 2 (1 double) → ok.
  assert.equal(computeBedLinenAlert({
    reservation: { adults: 2, teens: 0, children: 1, babies: 0, doubleBeds: 1, singleBeds: 0, babyBeds: 1 },
    options: [LINEN],
    bedLinenProvidedByDefault: false,
  }), null);
});

test('teens count toward required beds', () => {
  // 2 adults + 1 teen = 3 required; 1 double = 2 capacity → mismatch.
  assert.deepEqual(computeBedLinenAlert({
    reservation: { adults: 2, teens: 1, children: 0, babies: 0, doubleBeds: 1, singleBeds: 0, babyBeds: 0 },
    options: [LINEN],
    bedLinenProvidedByDefault: false,
  }), { type: 'capacity', capacity: 2, required: 3 });
});
