// Pure resolver of the stay settled at the door — specs/collect-stay-payment-at-check-in.md §3.3.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStayPayment } = require('../utils/stayPayment');

const TODAY = '2026-08-30';
const owed = { applicable: true, settled: false };
const paidElsewhere = { applicable: true, settled: true };

test('the step never ran → nothing is written', () => {
  assert.equal(resolveStayPayment({ bucket: owed, prev: {}, stayPaid: undefined, today: TODAY }), null);
});

test('settling an owed bucket stamps today, no cash', () => {
  assert.deepEqual(
    resolveStayPayment({ bucket: owed, prev: {}, stayPaid: true, stayPaidCash: false, today: TODAY }),
    { paid: 1, cash: 0, date: TODAY, atArrival: 1 },
  );
});

test('« Payé en liquide » flags the caisse interne', () => {
  assert.deepEqual(
    resolveStayPayment({ bucket: owed, prev: {}, stayPaid: true, stayPaidCash: true, today: TODAY }),
    { paid: 1, cash: 1, date: TODAY, atArrival: 1 },
  );
});

test('a non-applicable bucket is never touched (0 €, or a deposit opted out)', () => {
  const bucket = { applicable: false, settled: false };
  assert.equal(resolveStayPayment({ bucket, prev: {}, stayPaid: true, today: TODAY }), null);
});

test('a bucket already paid OUTSIDE the SAS is not re-stamped', () => {
  const prev = { paid: 1, cash: 0, date: '2026-06-01', atArrival: 0 };
  assert.equal(resolveStayPayment({ bucket: paidElsewhere, prev, stayPaid: true, today: TODAY }), null);
});

test('re-committing our own settlement keeps the original date and may correct the mode', () => {
  const prev = { paid: 1, cash: 0, date: '2026-07-10', atArrival: 1 };
  assert.deepEqual(
    resolveStayPayment({ bucket: paidElsewhere, prev, stayPaid: true, stayPaidCash: true, today: TODAY }),
    { paid: 1, cash: 1, date: '2026-07-10', atArrival: 1 },
  );
});

test('« Pas maintenant » undoes what this SAS settled', () => {
  const prev = { paid: 1, cash: 1, date: '2026-07-10', atArrival: 1 };
  assert.deepEqual(
    resolveStayPayment({ bucket: paidElsewhere, prev, stayPaid: false, today: TODAY }),
    { paid: 0, cash: 0, date: null, atArrival: 0 },
  );
});

test('« Pas maintenant » never clears a payment made elsewhere', () => {
  const prev = { paid: 1, cash: 0, date: '2026-06-01', atArrival: 0 };
  assert.equal(resolveStayPayment({ bucket: paidElsewhere, prev, stayPaid: false, today: TODAY }), null);
});

test('« Pas maintenant » on an untouched, still-owed bucket writes nothing', () => {
  assert.equal(resolveStayPayment({ bucket: owed, prev: {}, stayPaid: false, today: TODAY }), null);
});
