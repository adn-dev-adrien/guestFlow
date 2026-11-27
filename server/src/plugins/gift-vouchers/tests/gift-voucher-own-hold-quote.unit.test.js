// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 17 (G18) — a recipient who comes back from the bank page asks the recap of the slot their own use holds: the voucher's own hold
// never takes the slot (nor the offered hour's block, nor the extra-time steps) from its own recap. Another visitor's hold still does.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.db.prepare('UPDATE resources SET slotDuration = 30 WHERE id = ?').run(s.ids.bath);
s.create({
  ...s.hour, name: 'soir', slug: 'soir', composition: { resourceId: s.ids.bath, band: 'evening', minutes: 60, options: [] }, addOns: [], extraTimeMaxMinutes: 120, periods: ['week', 'weekend'],
});

test('the recap of the slot the voucher\'s own held use sits on still answers, with its offered hour and its extra-time steps', async () => {
  const voucher = s.sell('soir', 'weekend');
  const request = { extraMinutes: 30 };
  const before = s.quoteOf(voucher, f.TUESDAY, '10:00', request);
  assert.equal(before.ok, true, JSON.stringify(before));
  const held = await s.confirm(voucher, f.TUESDAY, '10:00', request);
  assert.equal(held.ok, true, JSON.stringify(held));
  const again = s.quoteOf(voucher, f.TUESDAY, '10:00', request);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.deepEqual(again.data.gifts, before.data.gifts);
  assert.equal(again.data.end, before.data.end);
  assert.deepEqual(again.data.extraTimePrices, before.data.extraTimePrices);
});

test('another visitor\'s hold on the slot still refuses it', async () => {
  const voucher = s.sell('soir', 'weekend');
  const other = s.offerOfBath.offer.hold({ resourceId: s.ids.bath, date: f.TUESDAY, start: '15:00', end: '16:00', ref: 'other-visitor', now: s.clock.at });
  assert.equal(other.ok, true);
  const taken = s.quoteOf(voucher, f.TUESDAY, '15:00');
  assert.equal(taken.ok, false);
  assert.equal(taken.code, 'SLOT_TAKEN');
});
