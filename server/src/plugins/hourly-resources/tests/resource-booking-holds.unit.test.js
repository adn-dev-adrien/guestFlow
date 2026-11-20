// specs/gift-voucher-campaigns.md rules 25, 29 (§4.1) — the booking offer of the outside bookings, asked of the core by another plugin (it names no voucher): free slots inside the
// opening hours, the hold of 15 minutes that blocks every availability read until it is released or lapses, the job that tidies the lapsed ones, and the booking that consumes a hold.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./outsideBookingFixture');

const bath = fx.newResource();
const slotsOf = (date = fx.DAY, minutes = 120, over = {}) => fx.offer.freeSlots({
  resourceId: bath, from: date, to: date, minutes, now: fx.NOW, ...over,
}).days.flatMap((day) => day.slots.map((s) => s.start));
const holdSlot = (ref, start = '10:00', end = '12:00') => fx.offer.hold({
  resourceId: bath, date: fx.DAY, start, end, ref, now: fx.NOW,
});
const lapse = (ref) => fx.db.prepare("UPDATE resource_booking_holds SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE ref = ?").run(ref);

test('the offer is reached through the core: the plugin declares it, the job that tidies the holds runs every minute', () => {
  assert.deepEqual(Object.keys(fx.offer).sort(), ['bookOutside', 'freeSlots', 'hold', 'quote', 'release']);
  const record = fx.registry.get('hourly-resources');
  assert.deepEqual(record.jobs.filter((j) => j.name === 'resource-holds-expire').map((j) => j.intervalMs), [60 * 1000]);
});

test('free slots: a 2 h session from each hour of the opening window, the last one ending by closing time, past days and the horizon left out', () => {
  assert.deepEqual(slotsOf(), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']);
  const answer = fx.offer.freeSlots({ resourceId: bath, from: '2026-11-10', to: '2026-11-17', minutes: 120, now: fx.NOW });
  assert.deepEqual(answer.days.map((d) => d.date), ['2026-11-15', '2026-11-16', '2026-11-17'], 'nothing before today');
  assert.equal(answer.days[0].slots[0].start, '11:00', 'today: not before now (11:00 in Paris)');
  assert.equal(answer.horizonUntil, '2027-02-15');
  const beyond = fx.offer.freeSlots({ resourceId: bath, from: '2027-02-16', to: '2027-03-01', minutes: 120, now: fx.NOW });
  assert.deepEqual(beyond.days, []);
});

test('a band keeps the starts before the evening switch (day) or from it (evening)', () => {
  assert.deepEqual(slotsOf(fx.DAY, 120, { band: 'evening' }), ['19:00', '20:00']);
  assert.deepEqual(slotsOf(fx.DAY, 120, { band: 'day' }), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
});

test('a hold blocks its slot in every availability read — free slots, the planning, the outside slots, the occupancy of the guest app and the check of a write', () => {
  const held = holdSlot('probe:1', '14:00', '16:00');
  assert.equal(held.ok, true);
  assert.deepEqual(slotsOf(fx.DAY, 120).filter((s) => ['13:00', '14:00', '15:00', '16:00'].includes(s)), ['16:00'], 'a 2 h session may not start at 13:00, 14:00 or 15:00');
  assert.deepEqual(fx.bookings.listForResource({ resourceId: bath, date: fx.DAY }).filter((e) => e.held).map((e) => [e.startTime, e.endTime, e.displayName]), [['14:00', '16:00', 'Créneau retenu, paiement en cours']]);
  assert.deepEqual(fx.bookings.getOccupiedSlots(bath, fx.DAY).map((s) => [s.startTime, s.endTime]), [['14:00', '16:00']]);
  assert.deepEqual(fx.occupancy.listForStay({ resourceId: bath, startDate: fx.DAY, endDate: fx.DAY }).filter((o) => o.kind === 'hold').map((o) => [o.start, o.end]), [['14:00', '16:00']]);
  const refused = fx.bookings.createBooking({
    resourceId: bath, date: fx.DAY, startTime: '15:00', endTime: '16:00', clientName: 'Un autre',
  });
  assert.equal(refused.status, 409);
  assert.equal(fx.offer.hold({
    resourceId: bath, date: fx.DAY, start: '15:00', end: '17:00', ref: 'probe:2', now: fx.NOW,
  }).code, 'SLOT_TAKEN');
  fx.offer.release('probe:1');
  assert.ok(slotsOf().includes('14:00'), 'released: the slot is free again at once');
});

test('a hold lapses the second its 15 minutes end, whether or not the job has marked it; the job marks it and frees nothing it should not', () => {
  holdSlot('lapse:1', '10:00', '12:00');
  assert.equal(slotsOf().includes('10:00'), false);
  lapse('lapse:1');
  assert.equal(slotsOf().includes('10:00'), true, 'a lapsed hold blocks nothing, before the job');
  assert.equal(fx.holdRows('lapse:1')[0].releasedAt, null);
  holdSlot('live:1', '14:00', '16:00');
  const tidied = fx.registry.get('hourly-resources').jobs.find((j) => j.name === 'resource-holds-expire').run();
  assert.equal(tidied, 1);
  assert.notEqual(fx.holdRows('lapse:1')[0].releasedAt, null);
  assert.equal(fx.holdRows('live:1')[0].releasedAt, null, 'a live hold is left alone');
  fx.offer.release('live:1');
});

test('a hold placed again under the same reference replaces the first: one active hold per reference', () => {
  holdSlot('again:1', '10:00', '12:00');
  holdSlot('again:1', '16:00', '18:00');
  assert.equal(slotsOf().includes('10:00'), true);
  assert.equal(slotsOf().includes('16:00'), false);
  assert.equal(fx.holdRows('again:1').filter((h) => !h.releasedAt).length, 1);
  fx.offer.release('again:1');
});

test('the booking that consumes a hold is not blocked by it, and the hold is released with it — one transaction; another buyer is blocked while it is held', () => {
  const tub = fx.newResource({ name: 'Bain B' });
  const ask = () => fx.offer.quote({ resourceId: tub, date: fx.DAY, start: '10:00', coveredBand: 'day', coveredMinutes: 120 });
  const quote = ask();
  const book = (holdRef) => fx.offer.bookOutside({
    resourceId: tub,
    date: fx.DAY,
    start: '10:00',
    end: '12:00',
    customer: { name: 'Léa', email: 'lea@example.test', phone: '0600000000' },
    fulfilments: [{ role: 'session', ...quote.session.line }],
    tenders: [{ method: 'card', amountCents: quote.session.totalCents, source: 'payment-link:9' }],
    holdRef,
    channel: 'mon-bain',
    now: fx.NOW,
  });
  assert.equal(fx.offer.hold({
    resourceId: tub, date: fx.DAY, start: '10:00', end: '12:00', ref: 'own:1', now: fx.NOW,
  }).ok, true);
  const blocked = book('someone-else');
  assert.deepEqual([blocked.ok, blocked.code], [false, 'SLOT_TAKEN']);
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE resourceId = ?').get(tub).n, 0, 'a refusal writes no booking');
  const done = book('own:1');
  assert.equal(done.ok, true);
  assert.equal(fx.holdRows('own:1')[0].releasedAt !== null, true);
  const row = fx.db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(done.bookingId);
  assert.deepEqual([row.reservationId, row.saleRef, row.clientName], [null, `standalone:${done.saleId}`, 'Léa']);
  assert.equal(book('own:1').code, 'SLOT_TAKEN', 'booked once: the second ask finds the slot taken');
});

test('a hold on a resource that is not sold by the hour, or on a past slot, is refused', () => {
  const flat = fx.newResource({ name: 'Vélo', priceType: 'per_stay', showsPlanningCard: 0 });
  assert.equal(fx.offer.hold({
    resourceId: flat, date: fx.DAY, start: '10:00', end: '12:00', ref: 'flat:1', now: fx.NOW,
  }).code, 'RESOURCE_UNAVAILABLE');
  assert.equal(fx.offer.hold({
    resourceId: bath, date: '2026-11-10', start: '10:00', end: '12:00', ref: 'past:1', now: fx.NOW,
  }).ok, false);
});

test('the offer stays generic: the files that carry it name no consumer — no « voucher », no « bon cadeau »', () => {
  const fs = require('fs');
  const path = require('path');
  ['outsideOffer.js', 'holdsModel.js', 'lineMarksModel.js', 'ficheModel.js']
    .forEach((file) => assert.equal(/voucher|bon cadeau/i.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')), false, file));
});
