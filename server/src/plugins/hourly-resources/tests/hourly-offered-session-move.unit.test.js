// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 29, 30 (round 4, D) — a session line offered at the visit (« Offrir ») is one figure on every reader of the booking, through
// the offer itself, a notes-only save and a move: the stored total follows the document's session figure.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const quiet = console.log;
console.log = () => {};
const v = require('./visitFixture');
const standaloneSale = require('../../../utils/standaloneSale');
console.log = quiet;

const {
  bookings, visits, row, resourceId, DAY,
} = v;

test('a session offered at the visit stays one figure (0 €) on the booking, the preview, the invoice basis and the document — offered, saved, moved, saved again', () => {
  const id = Number(bookings.createBooking({ resourceId, date: DAY, startTime: '10:00', endTime: '11:00', clientName: 'X' }).id);
  const saleId = visits.ensureDocument(row(id), { actor: 'user:1', stop: (r) => { throw new Error(JSON.stringify(r)); } });
  const lines = () => standaloneSale.documentOf(saleId).lines.filter((l) => String(l.fulfilmentRef || '').startsWith(`hourly-slot:${id}`) && l.status !== 'cancelled');
  const figures = () => {
    const r = row(id);
    const p = bookings.priceBooking({ resourceId, bookingId: id, date: r.date, startTime: r.startTime, endTime: r.endTime, propertyId: r.propertyId, offeredMinutes: r.offeredMinutes });
    return {
      stored: Math.round(r.totalPrice * 100), preview: p.error || Math.round(p.total * 100), invoice: Math.round(bookings.invoiceBasis(id).breakdown.total * 100), document: lines().reduce((t, l) => t + l.totalCents, 0),
    };
  };
  const one = (label, expected) => assert.deepEqual(figures(), { stored: expected, preview: expected, invoice: expected, document: expected }, label);
  one('created and on its document', 5000);
  assert.deepEqual(visits.patchLine(row(id), lines()[0].id, { offered: true }), { ok: true });
  one('offered at the visit: the stored total follows at once', 0);
  bookings.update(id, { notes: 'n' });
  one('notes-only save', 0);
  const moved = bookings.update(id, { startTime: '12:00', endTime: '13:00' });
  assert.equal(moved.ok, true);
  assert.equal(moved.totalPrice, 0, 'the answer of the move carries the document figure');
  one('moved: the document keeps its own figure, so does the booking', 0);
  bookings.update(id, { notes: 'n2' });
  one('notes-only save after the move', 0);
  assert.deepEqual(visits.patchLine(row(id), lines()[0].id, { offered: false }), { ok: true });
  one('the offer taken back: the booking is worth the slot again', 5000);
});
