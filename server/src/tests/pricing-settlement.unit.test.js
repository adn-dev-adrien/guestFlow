// specs/pricing-components.md §3 rules 22 and 29 — SETTLEMENT alone: the lines routed to the arrival complement
// (`inComplement`), the mid-stay split with the notes already collected netted out, the live itemisation of the arrival
// complement, the three amounts filed by the moment they are collected, and the deferral reading of a stored row. The old
// modules re-export the same functions. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const settlement = require('../utils/pricing/settlement');
const midStayExtras = require('../utils/midStayExtras');
const complementBuckets = require('../utils/complementBuckets');
const checkoutComplement = require('../utils/checkoutComplement');

const { readInComplement, planSettlement, splitComplementBuckets, resolveMidStaySplit, isComplementDeferred } = settlement;

test('rule 22 — the old modules re-export the very functions of SETTLEMENT', () => {
  for (const name of ['resolveMidStaySplit', 'extraLineKey', 'settledByKey', 'buildMidStayLine', 'parseNotes', 'ARRIVAL_COMPLEMENT_EXCESS_KEY']) {
    assert.equal(midStayExtras[name], settlement[name], name);
  }
  assert.equal(complementBuckets.splitComplementBuckets, splitComplementBuckets);
  for (const name of ['isComplementDeferred', 'mergedEndOfStayAmount', 'markCarriesEndOfStay', 'endOfStaySettledApart']) {
    assert.equal(checkoutComplement[name], settlement[name], name);
  }
});

test('rule 22 — readInComplement: forced lines plus the extra guests billed there, less the part sold during the stay', () => {
  const lines = [
    { title: 'Bain', totalPrice: 60, inComplement: 1 },
    { title: 'Linge', totalPrice: 20, inComplement: 0 },
    { title: 'Ménage', totalPrice: 45.5, inComplement: true },
  ];
  assert.deepEqual(
    readInComplement({ finalOptionLines: lines, resourceLines: [{ title: 'Sauna', totalPrice: 10, inComplement: 1 }], extraGuestComplementSurcharge: 12.34, midStayForced: 30 }),
    { forcedItemsTotal: 127.84, complementForcedItemsTotal: 97.84 },
  );
  assert.deepEqual(
    readInComplement({ finalOptionLines: [], resourceLines: [], extraGuestComplementSurcharge: 0, midStayForced: 5 }),
    { forcedItemsTotal: 0, complementForcedItemsTotal: 0 },
  );
});

test('rule 29 — splitComplementBuckets files an unsettled deferred arrival complement at the end of the stay; the total never moves', () => {
  const base = { complementAmount: 40, complementPaid: 0, midStaySettledTotal: 15, endOfStayComplementTotal: 25 };
  assert.deepEqual(splitComplementBuckets({ ...base, deferred: false }), { arrival: 40, duringStay: 15, endOfStay: 25 });
  assert.deepEqual(splitComplementBuckets({ ...base, deferred: true }), { arrival: 0, duringStay: 15, endOfStay: 65 });
  assert.deepEqual(splitComplementBuckets({ ...base, complementPaid: 1, deferred: true }), { arrival: 40, duringStay: 15, endOfStay: 25 });
  assert.deepEqual(splitComplementBuckets({ ...base, deferred: true, filedAtEndOfStay: false }), { arrival: 40, duringStay: 15, endOfStay: 25 });
});

test('rule 22 — the mid-stay split nets the notes already collected out of what is still due', () => {
  const lines = [{ optionId: 1, title: 'Petit déjeuner', totalPrice: 30, quantity: 3 }];
  const baseline = settlement.buildExtrasBaseline([{ optionId: 1, title: 'Petit déjeuner', totalPrice: 10, quantity: 1 }]);
  const split = resolveMidStaySplit(lines, { baseline, settled: false, storedLines: [], notes: [] });
  assert.equal(split.total, 20);
  assert.equal(split.remainingTotal, 20);
  assert.equal(split.settledTotal, 0);
  const key = settlement.extraLineKey(lines[0]);
  const netted = resolveMidStaySplit(lines, { baseline, settled: false, storedLines: [], notes: [{ id: 1, key, amount: 8, paid: true }] });
  assert.equal(netted.settledTotal + netted.remainingTotal, netted.total);
});

test('rule 22 — planSettlement itemises the arrival complement live: forced lines, extra guests, the tax and a remainder', () => {
  const finalOptionLines = [
    { optionId: 1, title: 'Bain nordique', totalPrice: 50, quantity: 1, unitPrice: 50, billedUnits: 1, inComplement: 1 },
    { optionId: 2, title: 'Linge', totalPrice: 10, quantity: 1, unitPrice: 10, inComplement: 0 },
    { optionId: 3, title: 'Offert', totalPrice: 20, quantity: 1, unitPrice: 20, inComplement: 1, offered: 1 },
  ];
  const { complementDetailLines, complementSplit } = planSettlement({
    lines: {
      finalOptionLines, resourceLines: [], midStayExtras: { byKey: {} }, extraGuestComplementSurcharge: 24, extraGuestComplementCount: 2,
    },
    stayLevel: {
      resolvedComplementAmount: 130, taxInComplement: 36, isTouristTaxCollectedOnArrival: true, isTouristTaxForcedToComplement: false,
      midStaySettledAll: 0, endOfStayComplementTotal: 0,
    },
    receipts: { complementPaid: 0, complementCollected: undefined, complementDeferredToCheckout: false },
  });
  assert.deepEqual(complementDetailLines.map((line) => [line.kind, line.amount]), [
    ['option', 50], ['extraGuests', 24], ['tax', 36], ['remainder', 20],
  ]);
  assert.equal(complementDetailLines[1].unitPrice, 12);
  assert.deepEqual(complementSplit, { arrival: 130, duringStay: 0, endOfStay: 0 });
});

test('rule 22 — the part of a forced line sold during the stay is billed at check-out, not itemised in the arrival complement', () => {
  const line = { optionId: 1, title: 'Bain nordique', totalPrice: 50, quantity: 1, unitPrice: 50, inComplement: 1 };
  const key = settlement.extraLineKey(line);
  const { complementDetailLines } = planSettlement({
    lines: { finalOptionLines: [line], resourceLines: [], midStayExtras: { byKey: { [key]: 20 } }, extraGuestComplementSurcharge: 0, extraGuestComplementCount: 0 },
    stayLevel: {
      resolvedComplementAmount: 30, taxInComplement: 0, isTouristTaxCollectedOnArrival: false, isTouristTaxForcedToComplement: false,
      midStaySettledAll: 0, endOfStayComplementTotal: 20,
    },
    receipts: { complementPaid: 0, complementCollected: 0, complementDeferredToCheckout: false },
  });
  assert.deepEqual(complementDetailLines.map((entry) => entry.amount), [30]);
});

test('rule 22 — the added-guests tax carries its own label and flag when it rides the complement without being forced there', () => {
  const { complementDetailLines } = planSettlement({
    lines: { finalOptionLines: [], resourceLines: [], midStayExtras: { byKey: {} }, extraGuestComplementSurcharge: 0, extraGuestComplementCount: 0 },
    stayLevel: {
      resolvedComplementAmount: 5, taxInComplement: 5, isTouristTaxCollectedOnArrival: false, isTouristTaxForcedToComplement: false,
      midStaySettledAll: 0, endOfStayComplementTotal: 0,
    },
    receipts: { complementPaid: 0, complementCollected: 0, complementDeferredToCheckout: false },
  });
  assert.equal(complementDetailLines.length, 1);
  assert.equal(complementDetailLines[0].addedGuests, true);
  assert.notEqual(complementDetailLines[0].label, 'Taxe de séjour');
});

test('rule 22 — isComplementDeferred: the marker, an arrival part above 0, and not settled apart from the end of stay', () => {
  assert.equal(isComplementDeferred({ complementDeferredToCheckout: 1, complementAmount: 40 }), true);
  assert.equal(isComplementDeferred({ complementDeferredToCheckout: 1, complementAmount: 0 }), false);
  assert.equal(isComplementDeferred({ complementDeferredToCheckout: 0, complementAmount: 40 }), false);
  assert.equal(isComplementDeferred({ complementDeferredToCheckout: 1, complementAmount: 40, complementPaid: 1, endOfStayComplementAmount: 10 }), false);
  assert.equal(isComplementDeferred({ complementDeferredToCheckout: 1, complementAmount: 10 }, 25), true);
});
