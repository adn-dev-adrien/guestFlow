// Audit 2026-10-28 (injection finding 3) — the amount scan of a « Sous-total » / « Taxe de séjour » line
// is linear: an 80 KB line of digits used to cost ~15 s. specs/booking-extranet-intake.md rule 8.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBookingPage } = require('../pageParser');
const { PAGE_6392081711 } = require('./fixtures');

test('rule 8: a huge Sous-total line is read in linear time and still refused or parsed, never stalled', () => {
  const hostile = PAGE_6392081711.replace('Sous-total\t€ 701,80', `Sous-total\t${'1 '.repeat(40000)}`);
  const started = Date.now();
  const out = parseBookingPage(hostile, { resId: '6392081711' });
  assert.ok(Date.now() - started < 1000, 'bounded work');
  assert.equal(out.ok, false);
});

test('rule 8: the usual amounts are unchanged by the bounded scan', () => {
  const { ok, booking } = parseBookingPage(PAGE_6392081711, { resId: '6392081711' });
  assert.equal(ok, true);
  assert.deepEqual([booking.subtotal, booking.touristTax], [701.8, 20.02]);
});
