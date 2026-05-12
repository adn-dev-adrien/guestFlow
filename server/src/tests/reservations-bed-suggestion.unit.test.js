const test = require('node:test');
const assert = require('node:assert/strict');

const reservationsRoute = require('../routes/reservations');

const { suggestBedDistribution } = reservationsRoute.__test;

test('suggestBedDistribution prioritizes adults in double beds', () => {
  const result = suggestBedDistribution({
    adults: 3,
    children: 0,
    teens: 0,
    maxSingleBeds: 4,
    maxDoubleBeds: 2,
  });

  assert.equal(result.doubleBeds, 2);
  assert.equal(result.singleBeds, 0);
  assert.equal(result.unassignedPeople, 0);
});

test('suggestBedDistribution prioritizes children and teens in single beds', () => {
  const result = suggestBedDistribution({
    adults: 2,
    children: 2,
    teens: 1,
    maxSingleBeds: 3,
    maxDoubleBeds: 2,
  });

  assert.equal(result.doubleBeds, 1);
  assert.equal(result.singleBeds, 3);
  assert.equal(result.unassignedPeople, 0);
});

test('suggestBedDistribution never exceeds configured bed limits', () => {
  const result = suggestBedDistribution({
    adults: 6,
    children: 4,
    teens: 2,
    maxSingleBeds: 2,
    maxDoubleBeds: 2,
  });

  assert.equal(result.singleBeds <= 2, true);
  assert.equal(result.doubleBeds <= 2, true);
});

test('suggestBedDistribution reports unassigned people when capacity is insufficient', () => {
  const result = suggestBedDistribution({
    adults: 4,
    children: 3,
    teens: 1,
    maxSingleBeds: 1,
    maxDoubleBeds: 1,
  });

  assert.equal(result.singleBeds, 1);
  assert.equal(result.doubleBeds, 1);
  assert.equal(result.unassignedPeople, 5);
});

test('suggestBedDistribution ignores babies because input does not include them', () => {
  const baseline = suggestBedDistribution({
    adults: 2,
    children: 1,
    teens: 1,
    maxSingleBeds: 2,
    maxDoubleBeds: 1,
  });

  const sameGuests = suggestBedDistribution({
    adults: 2,
    children: 1,
    teens: 1,
    maxSingleBeds: 2,
    maxDoubleBeds: 1,
  });

  assert.deepEqual(sameGuests, baseline);
});
