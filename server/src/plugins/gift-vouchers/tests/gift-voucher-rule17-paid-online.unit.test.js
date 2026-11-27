// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 17 — the offered hour survives the remainder being paid online: the payment re-composes the choice while
// the use's own hold still sits on the doubled block, and that hold never counts against it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.campaign('soir', 'evening');
s.settingsStore.set('leftoverDrinkArticleRef', `option:${s.ids.drink}`);

const DAYS = [f.TUESDAY, '2026-11-18', '2026-11-24']; // date-literal-ok: the suite runs on its own clock, never the real today
[['10:00', 60], ['17:00', 60], ['16:00', 120]].forEach(([start, extra], i) => {
  const day = DAYS[i];
  test(`2 h + ${extra} min of extra time paid by card at ${start} books the doubled session with « Heure offerte » and the extra after it`, async () => {
    const v = s.sell('soir', 'weekend');
    const recap = s.quoteOf(v, day, start, { extraMinutes: extra });
    assert.equal(recap.ok, true, JSON.stringify(recap));
    assert.ok(recap.data.gifts.some((g) => g.label === 'Heure offerte'));
    const held = await s.confirm(v, day, start, { extraMinutes: extra });
    assert.equal(held.ok, true, JSON.stringify(held));
    const use = s.db.prepare('SELECT * FROM gift_voucher_uses ORDER BY id DESC LIMIT 1').get();
    assert.equal(use.dueCents, recap.data.dueCents);
    const paid = s.api.useService.paid({ ref: use.id, linkId: use.linkId, amountCents: use.dueCents });
    assert.deepEqual(paid, { effect: 'bath-booked' });
    const after = s.db.prepare('SELECT * FROM gift_voucher_uses WHERE id = ?').get(use.id);
    assert.equal(after.state, 'booked');
    const sale = s.saleOf(after.bookingId);
    const offered = sale.lines.find((l) => l.label === 'Heure offerte');
    assert.deepEqual([offered.totalCents, offered.offered], [0, true]);
    assert.equal(sale.lines.find((l) => l.label === 'Boisson').offered, true);
    const booking = s.db.prepare('SELECT startTime, endTime FROM resource_bookings WHERE id = ?').get(after.bookingId);
    assert.deepEqual([booking.startTime, booking.endTime], [use.startTime, use.endTime]);
    assert.equal(sale.totals.totalCents, 5000 + recap.data.dueCents);
  });
});
