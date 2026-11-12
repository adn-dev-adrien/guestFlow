// specs/pricing-components.md §3 rules 63 and 64 — the journal entries of a refund (`utils/pricing/refunds/journal.js`),
// moved from the accounting-export plugin: the avoir of a refund, the share given back from an indemnity (cumulative, so the
// shares add up to the compensation's HT), and the closing of a split stay's books.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRefundEntry, isAdjustedLine, indemnityShare, closeStayBooks,
} = require('../utils/pricing/refunds/journal');

test('rule 64: an indemnity given back in two shares books the compensation HT once', () => {
  const config = { account: '75880000', vatRatePercent: 10, priorTtc: 0 };
  const first = indemnityShare(50, config);
  const second = indemnityShare(50, { ...config, priorTtc: 50 });
  assert.deepEqual(first, { account: '75880000', ht: 45.45, vat: 4.55, ratePercent: 10 });
  assert.deepEqual(second, { account: '75880000', ht: 45.46, vat: 4.54, ratePercent: 10 });
  assert.equal(Math.round((first.ht + second.ht) * 100) / 100, 90.91);
  assert.deepEqual(indemnityShare(40, null), { account: null, ht: 40, vat: 0, ratePercent: 0 });
});

test('rule 63: a refund is an avoir with its buckets split at the rate of their lines, the tourist tax apart', () => {
  const entry = buildRefundEntry({
    id: 7, reservationId: 3, refundDate: '2027-02-01', totalTtc: 115, method: 'transfer', reason: 'x',
    lines: [{ bucket: 'accommodation', vatRate: 10, amountTtc: 110 }, { bucket: 'touristTax', vatRate: 0, amountTtc: 5 }],
  });
  assert.equal(entry.direction, 'refund');
  assert.equal(entry.encaissementTtc, 115);
  assert.equal(entry.taxTtc, 5);
  assert.deepEqual(entry.buckets, [{ name: 'accommodation', ht: 100, vat: 10, ratePercent: 10 }]);
  assert.equal(buildRefundEntry({ id: 8, totalTtc: 0, lines: [] }), null);
});

test('rule 63: a line adjusted for earlier refunds keeps the TTC it was booked on', () => {
  assert.equal(isAdjustedLine({ bucket: 'accommodation', unitPrice: 100, amountTtc: 60 }), true);
  assert.equal(isAdjustedLine({ bucket: 'accommodation', unitPrice: 60, amountTtc: 60 }), false);
  assert.equal(isAdjustedLine({ bucket: 'touristTax', unitPrice: 100, amountTtc: 60 }), false);
  assert.equal(isAdjustedLine({ bucket: 'accommodation', amountTtc: 60 }), false);
});

test('rule 64: the refund that gives back the last of the book money closes each sale account at exactly 0', () => {
  const sale = { paidDate: '2027-01-05' };
  const legs = (cents) => (map, entry) => { map.set('70600000', { cents: entry === sale ? cents : -cents, role: 'revenue', ratePercent: 10 }); return map; };
  const refundEntry = { kind: 'refund' };
  const deps = {
    entriesOfStay: () => [sale],
    earlierRefundsOf: () => [],
    entryOf: () => null,
    addSaleLegs: (map, entry) => legs(10000)(map, entry),
  };
  const closed = closeStayBooks(refundEntry, { reservationId: 3, refundDate: '2027-02-01' }, deps);
  assert.deepEqual(closed.closing, [{ account: '70600000', role: 'revenue', ratePercent: 10, amount: 100 }]);
  const notClosing = closeStayBooks(refundEntry, { reservationId: 3, refundDate: '2027-02-01' }, { ...deps, addSaleLegs: (map) => { map.set('70600000', { cents: 100, role: 'revenue', ratePercent: 10 }); return map; } });
  assert.equal(notClosing, refundEntry);
});
