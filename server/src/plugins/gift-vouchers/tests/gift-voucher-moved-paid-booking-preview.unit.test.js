// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 17 + specs/resources outside-visit « booking moved after its session was sold » — the preview of a move of a
// paid voucher booking (a doubled-hour use carries an offered « Heure offerte » line) gives the save's refusal, never 0 €.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const { createVisitModel } = require('../../hourly-resources/visitModel');
const bookingsModule = require('../../hourly-resources/bookingsModel');

const s = f.setup();
const bathId = s.ids.bath;
s.db.prepare('UPDATE resources SET quantity = 6, turnoverMinutes = 0, bookingHorizonMonths = 120, slotDuration = 30, minimumUsageMinutes = 60 WHERE id = ?').run(bathId);
let visits = null;
const model = bookingsModule.create(s.db, { standaloneVatRate: () => 20, visits: () => visits });
visits = createVisitModel({ db: s.db, bookings: () => model });
s.create({
  ...s.hour, name: 'soir', slug: 'soir', composition: { resourceId: bathId, band: 'evening', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 120, periods: ['week', 'weekend'],
});

test('the preview of a move of a paid doubled-hour voucher booking refuses like the save', async () => {
  const voucher = s.sell('soir', 'weekend');
  const confirmed = await s.confirm(voucher, f.TUESDAY, '11:00', {});
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  if (confirmed.data && confirmed.data.payUrl) {
    const use = s.db.prepare('SELECT * FROM gift_voucher_uses ORDER BY id DESC LIMIT 1').get();
    s.api.useService.paid({ ref: use.id, linkId: use.linkId, amountCents: use.dueCents });
    await new Promise((resolve) => setImmediate(resolve));
  }
  const row = s.db.prepare('SELECT * FROM resource_bookings ORDER BY id DESC LIMIT 1').get();
  const move = { startTime: '16:00', endTime: '18:00' };
  const preview = model.priceBooking({ resourceId: bathId, bookingId: row.id, date: row.date, ...move, propertyId: row.propertyId, offeredMinutes: row.offeredMinutes });
  const saved = model.update(row.id, move);
  assert.equal(saved.code, 'BOOKING_PAID');
  assert.equal(preview.code, 'BOOKING_PAID');
  assert.equal(preview.error, saved.error);
  assert.equal(preview.status, saved.status);
  const unchanged = s.db.prepare('SELECT startTime FROM resource_bookings WHERE id = ?').get(row.id);
  assert.equal(unchanged.startTime, row.startTime);
});
