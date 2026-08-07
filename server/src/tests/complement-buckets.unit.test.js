/**
 * specs/complement-buckets-by-moment.md — a complement is filed under the moment it is collected.
 * Every case also checks rule 6: the split never changes a total.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitComplementBuckets } = require('../utils/complementBuckets');

const round2 = (n) => Math.round(n * 100) / 100;

// Rule 6 — arrival + duringStay + endOfStay === what went in. Compared against the sum of the
// CENT-ROUNDED inputs: the split rounds each amount before filing it, and every real input already
// arrives rounded (the engine's roundMoney). Rounding the raw sum instead would drift by a cent on
// inputs that never occur in production.
function splitAndCheck(input) {
  const out = splitComplementBuckets(input);
  const expected = round2(
    round2(Number(input.complementAmount || 0))
    + round2(Number(input.midStaySettledTotal || 0))
    + round2(Number(input.endOfStayComplementTotal || 0)),
  );
  assert.equal(
    round2(out.arrival + out.duringStay + out.endOfStay), expected,
    `invariant broken for ${JSON.stringify(input)}`,
  );
  return out;
}

test('stay not started: the arrival complement is a forecast, filed under arrival', () => {
  assert.deepEqual(
    splitAndCheck({ complementAmount: 40, complementPaid: 0, stayStarted: false }),
    { arrival: 40, duringStay: 0, endOfStay: 0 },
  );
});

test('stay started and collected at check-in: stays under arrival', () => {
  assert.deepEqual(
    splitAndCheck({ complementAmount: 40, complementPaid: 1, stayStarted: true }),
    { arrival: 40, duringStay: 0, endOfStay: 0 },
  );
});

test('stay started and NOT collected: moves to the end-of-stay bucket', () => {
  assert.deepEqual(
    splitAndCheck({ complementAmount: 40, complementPaid: 0, stayStarted: true }),
    { arrival: 0, duringStay: 0, endOfStay: 40 },
  );
});

test('stay started, not collected, on top of an existing end-of-stay complement: the two add up', () => {
  assert.deepEqual(
    splitAndCheck({
      complementAmount: 40, complementPaid: 0, stayStarted: true, endOfStayComplementTotal: 30,
    }),
    { arrival: 0, duringStay: 0, endOfStay: 70 },
  );
});

test('sales collected during the stay have their own bucket, whatever the arrival state', () => {
  assert.deepEqual(
    splitAndCheck({
      complementAmount: 24, complementPaid: 1, stayStarted: true,
      midStaySettledTotal: 17, endOfStayComplementTotal: 6.5,
    }),
    { arrival: 24, duringStay: 17, endOfStay: 6.5 },
  );
});

test('deferred AND collected → arrival: it WAS collected (rule 2 beats the deferral flag)', () => {
  assert.deepEqual(
    splitAndCheck({
      complementAmount: 40, complementPaid: 1, stayStarted: true, endOfStayComplementTotal: 12,
    }),
    { arrival: 40, duringStay: 0, endOfStay: 12 },
  );
});

test('no reservation (devis / public quote): not started → everything under arrival', () => {
  assert.deepEqual(
    splitAndCheck({ complementAmount: 55 }),
    { arrival: 55, duringStay: 0, endOfStay: 0 },
  );
  assert.deepEqual(splitComplementBuckets(), { arrival: 0, duringStay: 0, endOfStay: 0 });
  assert.deepEqual(splitComplementBuckets({}), { arrival: 0, duringStay: 0, endOfStay: 0 });
});

test('each amount is rounded to cents before the buckets are summed', () => {
  const out = splitAndCheck({
    complementAmount: 10.014, complementPaid: 0, stayStarted: true, endOfStayComplementTotal: 6.674,
  });
  assert.equal(out.endOfStay, 16.68); // 10.01 + 6.67, not 16.688
  assert.equal(out.arrival, 0);
});
