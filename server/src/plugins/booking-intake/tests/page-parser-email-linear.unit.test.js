// specs/settings-rationalization.md rule 33 (audit R2, finding N2) — the email line of the Booking page is bounded.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBookingPage } = require('../pageParser');
const { PAGE_6300000001 } = require('./fixtures');

const timed = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };
const HOSTILE = `x@${'.'.repeat(200000)},`;

test('rule 33: the Booking page parser reads a hostile dotted line in < 50 ms', () => {
  const page = PAGE_6300000001.replace('cgarnier.123456@guest.booking.com', HOSTILE);
  const { ms } = timed(() => parseBookingPage(page, { resId: '6300000001' }));
  assert.ok(ms < 50, `${ms} ms`);
});
