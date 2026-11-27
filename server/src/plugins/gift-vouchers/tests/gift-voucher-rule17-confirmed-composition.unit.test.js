// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 17 — the composition a recipient confirmed is the one the payment books. Every sequence of the other visitor's hold on the
// block after the session, its release, a booking on it and the lapse of the use's own hold, paid inside the hold or late, for each voucher kind and each request: either the booking spans
// exactly the confirmed span (the offered hour decided at the confirmation, never again), its sale lines lie inside it and the mail sentence follows the « Heure offerte » line, or the money
// is owed back and nothing is booked.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const { lapseHold } = require('./useFixture');

const s = f.setup();
s.db.prepare('UPDATE resources SET slotDuration = 30 WHERE id = ?').run(s.ids.bath);
for (const [slug, band] of [['soir', 'evening'], ['jour', 'day']]) {
  s.create({
    ...s.hour, name: slug, slug, composition: { resourceId: s.ids.bath, band, minutes: 60, options: [] }, addOns: [`option:${s.ids.drink}`], extraTimeMaxMinutes: 120, periods: ['week', 'weekend'],
  });
}
s.settingsStore.set('leftoverDrinkArticleRef', `option:${s.ids.drink}`);

const DAY = f.TUESDAY;
const minutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clockOf = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const reset = () => {
  s.db.prepare('DELETE FROM resource_bookings').run();
  s.db.prepare('DELETE FROM resource_booking_holds').run();
};

// What happens between the confirmation and the bank's word.
const SEQUENCES = [
  { name: 'nobody else, paid inside the hold', other: false, steps: [] },
  { name: 'the next block held at the confirmation, released before the payment', other: true, steps: ['release'] },
  { name: 'the next block held, released, then booked by someone else', other: true, steps: ['release', 'book'] },
  { name: 'own hold lapsed, the next block still free (paid late)', other: false, steps: ['lapse'] },
  { name: 'own hold lapsed, then the next block booked by someone else', other: false, steps: ['lapse', 'book'] },
  { name: 'next block held, own hold lapsed, then released (paid late)', other: true, steps: ['lapse', 'release'] },
];
const KINDS = [['soir', 'weekend'], ['jour', 'week']];
const REQUESTS = [['add-on only', { addOns: [{ articleRef: `option:${s.ids.drink}`, qty: 1 }] }, 0], ['extra 30', { extraMinutes: 30 }, 30], ['extra 60', { extraMinutes: 60 }, 60]];

for (const [slug, period] of KINDS) {
  for (const [requestName, request, extra] of REQUESTS) {
    for (const sequence of SEQUENCES) {
      test(`${slug} ${period} voucher, ${requestName}: ${sequence.name}`, async () => {
        reset();
        s.sent.length = 0;
        const voucher = s.sell(slug, period);
        const nextFrom = minutes('10:00') + 60 + extra;
        const nextBlock = { startTime: clockOf(nextFrom), endTime: clockOf(nextFrom + 60) };
        if (sequence.other) {
          const held = s.offerOfBath.offer.hold({ resourceId: s.ids.bath, date: DAY, start: nextBlock.startTime, end: nextBlock.endTime, ref: 'other-visitor', now: s.clock.at });
          assert.equal(held.ok, true);
        }
        const recap = s.quoteOf(voucher, DAY, '10:00', request);
        if (!recap.ok) {
          // The offered hour is decided first; extra time that does not fit after the doubled block is refused, never traded for the hour (rule 17).
          assert.equal(recap.code, 'EXTRA_TIME_UNAVAILABLE');
          assert.equal(slug, 'soir');
          return;
        }
        const confirmed = await s.confirm(voucher, DAY, '10:00', { ...request, end: recap.data.end });
        assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
        const use = s.db.prepare('SELECT * FROM gift_voucher_uses ORDER BY id DESC LIMIT 1').get();
        const confirmedRecap = JSON.parse(use.recap);
        const confirmedHour = confirmedRecap.gifts.some((g) => g.label === 'Heure offerte');
        assert.equal(use.endTime, confirmedRecap.end);

        for (const step of sequence.steps) {
          if (step === 'release') s.offerOfBath.offer.release('other-visitor');
          if (step === 'lapse') lapseHold(use.holdRef);
          if (step === 'book') {
            const taken = s.offerOfBath.bookings.createBooking({ resourceId: s.ids.bath, date: DAY, ...nextBlock, clientName: 'X', clientPhone: null, notes: '' });
            assert.ok(taken.id, JSON.stringify(taken));
          }
        }
        const outcome = s.api.useService.paid({ ref: use.id, linkId: use.linkId, amountCents: use.dueCents });
        const after = s.db.prepare('SELECT * FROM gift_voucher_uses WHERE id = ?').get(use.id);
        await new Promise((resolve) => setImmediate(resolve));

        if (!after.bookingId) {
          assert.equal(outcome.refundOwed, true, JSON.stringify(outcome));
          assert.equal(after.state, 'refund_owed');
          const mine = s.db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE date = ? AND startTime = ?').get(DAY, '10:00').n;
          assert.equal(mine, 0);
          return;
        }
        assert.equal(outcome.effect, 'bath-booked');
        const booking = s.db.prepare('SELECT startTime, endTime FROM resource_bookings WHERE id = ?').get(after.bookingId);
        assert.deepEqual([booking.startTime, booking.endTime], [use.startTime, confirmedRecap.end], 'the booking spans the confirmed span');
        const span = minutes(booking.endTime) - minutes(booking.startTime);
        assert.equal(span, 60 + (confirmedHour ? 60 : 0) + extra);
        const sale = s.saleOf(after.bookingId);
        const offered = sale.lines.filter((l) => l.label === 'Heure offerte');
        assert.equal(offered.length > 0, confirmedHour, 'the offered hour is the confirmed one');
        for (const line of sale.lines.filter((l) => l.components && l.components.some((c) => c.key.startsWith('band:')))) {
          for (const part of line.components.filter((c) => c.key.startsWith('band:'))) {
            const at = minutes(part.key.split(':').slice(2, 4).join(':'));
            assert.ok(at >= minutes(booking.startTime) && at < minutes(booking.endTime), `${line.label} (${part.key}) lies inside the booking`);
          }
        }
        const mail = s.sent.find((m) => m.key === `gift-voucher-use:${use.id}`);
        assert.ok(mail, 'the confirmation mail left');
        assert.equal(/heure supplémentaire vous est offerte/.test(mail.text), confirmedHour, 'the mail sentence follows the offered hour line');
      });
    }
  }
}
