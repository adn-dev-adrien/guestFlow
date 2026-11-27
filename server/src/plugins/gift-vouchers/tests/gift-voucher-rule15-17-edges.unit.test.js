// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 15 and 17 — the supplement is named by what costs more (odd grids included), a doubled slot shows its doubled end,
// extra time is offered only within what fits after the offered hour, the offered hour is judged at the band of the slot's start, and a confirmation never silently downgrades it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.campaign('jour', 'day');
s.campaign('soir', 'evening');
s.settingsStore.set('leftoverDrinkArticleRef', `option:${s.ids.drink}`);
const setRates = (over) => {
  const columns = Object.keys(over);
  s.db.prepare(`UPDATE resources SET ${columns.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...over, id: s.ids.bath });
};
const labelOf = (voucher, date, start) => s.slotsOf(voucher, date)[start].supplementLabel;

test('rule 15 — the supplement is named by what costs more: week-end, soirée, soirée week-end; neither (an odd grid) is « Supplément créneau »', () => {
  const day = s.sell('jour', 'week');
  assert.equal(labelOf(day, f.SATURDAY, '10:00'), 'Supplément week-end');
  assert.equal(labelOf(day, f.TUESDAY, '19:00'), 'Supplément soirée');
  assert.equal(labelOf(day, f.FRIDAY, '19:00'), 'Supplément soirée week-end');
  // Odd grid: the weekend evening (55) is dearer than the week day (50) but cheaper than both the weekend day (60) and the week evening (70).
  setRates({ hourlyExternalWeekendDayRate: 60, hourlyExternalWeekendEveningRate: 55 });
  const odd = s.sell('jour', 'week');
  const slot = s.slotsOf(odd, f.SATURDAY)['20:00'];
  assert.deepEqual([slot.supplementCents, slot.supplementLabel], [500, 'Supplément créneau']);
  setRates({ hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendEveningRate: 90 });
});

test('rule 15 — « evening » flags a slot only when it is an evening slot against a day voucher', () => {
  const day = s.sell('jour', 'weekend');
  assert.equal(s.slotsOf(day, f.SATURDAY)['20:00'].evening, true, 'a day voucher on an evening slot');
  const evening = s.sell('soir', 'week');
  const saturday = s.slotsOf(evening, f.SATURDAY);
  assert.equal(saturday['10:00'].evening, false, 'an evening voucher paying the weekend on a day slot');
  assert.equal(saturday['20:00'].evening, false, 'an evening voucher on an evening slot');
});

test('rule 17 — a doubled slot is listed with its doubled end', () => {
  const v = s.sell('soir', 'weekend');
  const slot = s.slotsOf(v, f.TUESDAY)['14:00'];
  assert.equal(slot.tag, 'twoHoursDrink');
  assert.equal(slot.end, '16:00');
});

test('rule 17 — the offered hour is judged at the band of the slot\'s start: an 18:30 slot (30-minute steps, evening from 19:00) is a day slot and is doubled', () => {
  setRates({ slotDuration: 30 });
  const v = s.sell('soir', 'weekend');
  const slot = s.slotsOf(v, '2026-11-18')['18:30']; // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(slot.tag, 'twoHoursDrink');
  assert.equal(slot.end, '20:30');
  setRates({ slotDuration: 60 });
});

test('rule 17 — extra time is offered only within what fits after the offered hour: the offered hour is kept, the slot is not listed with the extra that does not fit', async () => {
  const WED = '2026-11-25'; // date-literal-ok: the suite runs on its own clock, never the real today
  const blocker = s.sell('jour', 'week');
  assert.equal((await s.confirm(blocker, WED, '13:00')).ok, true);
  const v = s.sell('soir', 'weekend');
  assert.equal(s.slotsOf(v, WED)['11:00'].tag, 'twoHoursDrink', '11:00-13:00 is free: the hour is offered');
  assert.equal(s.slotsOf(v, WED, 60)['11:00'], undefined, '11:00 + 2 h + 1 h bought would run into the 13:00 booking: not listed, the hour is not given up');
  const refused = s.quoteOf(v, WED, '11:00', { extraMinutes: 60 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'EXTRA_TIME_UNAVAILABLE');
  const fits = s.quoteOf(v, WED, '10:00', { extraMinutes: 60 });
  assert.equal(fits.ok, true, '10:00-13:00 ends where the booking starts');
  assert.deepEqual([fits.data.start, fits.data.end], ['10:00', '13:00']);
});

test('rule 17 — a confirmation made after the offered hour became impossible is refused, never downgraded to one hour and a drink', async () => {
  const THU = '2026-11-26'; // date-literal-ok: the suite runs on its own clock, never the real today
  const v = s.sell('soir', 'weekend');
  const recap = s.quoteOf(v, THU, '14:00');
  assert.equal(recap.data.end, '16:00');
  assert.equal((await s.confirm(s.sell('jour', 'week'), THU, '15:00')).ok, true, 'someone books 15:00 meanwhile');
  const refused = await s.confirm(v, THU, '14:00', { end: recap.data.end });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'RECAP_CHANGED');
  assert.equal(refused.status, 409);
  const sansEnd = await s.confirm(v, THU, '14:00');
  assert.equal(sansEnd.ok, true, 'an older client that sends no end keeps its behaviour');
});
