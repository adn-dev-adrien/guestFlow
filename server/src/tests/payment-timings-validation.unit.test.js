// validatePaymentTimings — Paiements page input validation. See specs/online-payments-qonto.md §3.1.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePaymentTimings } = require('../utils/paymentTimingsValidation');

test('accepts a full valid payload, de-dupes + sorts the offsets', () => {
  const r = validatePaymentTimings({
    depositReminderOffsets: [0, -5, -5],
    balanceReminderOffsets: [-5, -10, 0],
    depositAbandonOffset: 1,
    depositLinkExpiryDays: 1,
    balanceAbandonOffset: 1,
    balanceLinkExpiryDays: 1,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.value.depositReminderOffsets, [-5, 0]); // de-duped + sorted
  assert.deepEqual(r.value.balanceReminderOffsets, [-10, -5, 0]);
  assert.equal(r.value.depositAbandonOffset, 1);
});

test('partial update: only the provided fields are returned', () => {
  const r = validatePaymentTimings({ balanceAbandonOffset: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value), ['balanceAbandonOffset']);
  assert.equal(r.value.balanceAbandonOffset, 2);
});

test('rejects a non-array offsets field', () => {
  const r = validatePaymentTimings({ depositReminderOffsets: '-5,0' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /depositReminderOffsets/);
});

test('rejects non-integer / out-of-range offsets', () => {
  assert.equal(validatePaymentTimings({ balanceReminderOffsets: [-5, 2.5] }).ok, false);
  assert.equal(validatePaymentTimings({ balanceReminderOffsets: [-5, 999] }).ok, false);
});

test('rejects negative or non-integer day fields', () => {
  assert.equal(validatePaymentTimings({ balanceAbandonOffset: -1 }).ok, false);
  assert.equal(validatePaymentTimings({ depositAbandonOffset: 1.5 }).ok, false);
  assert.equal(validatePaymentTimings({ balanceLinkExpiryDays: 'x' }).ok, false);
});

test('accepts 0 for day fields (e.g. expire on the due day)', () => {
  const r = validatePaymentTimings({ depositLinkExpiryDays: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.value.depositLinkExpiryDays, 0);
});
