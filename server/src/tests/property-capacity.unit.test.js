const test = require('node:test');
const assert = require('node:assert/strict');

// specs/property-capacity-single-total.md §3 — capacity is ONE total for everyone over 2
// (adults + children + teens ≤ maxGuests), babies bounded separately and never counted in.

const { checkGuestCapacity } = require('../utils/capacity');

const LODGE = { maxGuests: 5, maxBabies: 1 };

test('1 adulte + 1 enfant fits a 5-guest property (the production bug)', () => {
  assert.equal(checkGuestCapacity(LODGE, { adults: 1, children: 1, teens: 0, babies: 0 }), null);
});

test('any age mix under the total is accepted', () => {
  assert.equal(checkGuestCapacity(LODGE, { adults: 2, children: 2, teens: 1, babies: 0 }), null, 'exact fit');
  assert.equal(checkGuestCapacity(LODGE, { adults: 5, children: 0, teens: 0, babies: 0 }), null, 'all adults');
  assert.equal(checkGuestCapacity(LODGE, { adults: 1, children: 0, teens: 4, babies: 0 }), null, 'mostly teens');
});

test('the total is what breaches — not a per-age bucket', () => {
  const breach = checkGuestCapacity(LODGE, { adults: 3, children: 2, teens: 1, babies: 0 });
  assert.ok(breach, 'six over-2s in a five-guest property is refused');
  assert.deepEqual(breach.parts, [{ kind: 'guests', count: 6, max: 5 }]);
  assert.match(breach.message, /voyageurs: 6\/5/);
});

test('babies are out of the guest total and bounded on their own', () => {
  assert.equal(checkGuestCapacity(LODGE, { adults: 5, children: 0, teens: 0, babies: 1 }), null,
    'a baby does not consume a guest slot');
  const breach = checkGuestCapacity(LODGE, { adults: 2, children: 0, teens: 0, babies: 2 });
  assert.deepEqual(breach.parts, [{ kind: 'babies', count: 2, max: 1 }]);
});

test('both axes breached → both parts in one message', () => {
  const breach = checkGuestCapacity(LODGE, { adults: 6, children: 1, teens: 0, babies: 3 });
  assert.deepEqual(breach.parts.map((p) => p.kind), ['guests', 'babies']);
  assert.match(breach.message, /voyageurs: 7\/5 • bébés: 3\/1/);
});

test('a child sleeping in a baby bed still consumes a guest slot (§3 rule 5)', () => {
  // babyBeds is deliberately NOT an input of this rule: maxGuests counts people, not beds.
  const breach = checkGuestCapacity({ maxGuests: 2, maxBabies: 2 }, { adults: 2, children: 1, babies: 0 });
  assert.deepEqual(breach.parts, [{ kind: 'guests', count: 3, max: 2 }]);
});

test('maxGuests = 0 means "not configured" → the guest guard is off', () => {
  assert.equal(checkGuestCapacity({ maxGuests: 0, maxBabies: 2 }, { adults: 8, children: 4, babies: 1 }), null);
});

test('maxBabies = 0 means "no babies accepted" → still enforced', () => {
  const breach = checkGuestCapacity({ maxGuests: 0, maxBabies: 0 }, { adults: 2, babies: 1 });
  assert.deepEqual(breach.parts, [{ kind: 'babies', count: 1, max: 0 }]);
});

test('missing counts are tolerated — a stay always has at least its booker', () => {
  assert.equal(checkGuestCapacity({ maxGuests: 1, maxBabies: 0 }, {}), null);
  const breach = checkGuestCapacity({ maxGuests: 1, maxBabies: 0 }, { children: 1 });
  assert.deepEqual(breach.parts, [{ kind: 'guests', count: 2, max: 1 }]);
});
