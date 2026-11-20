// specs/guest-app.md rule 41, reading of 2026-11-10 (audit R36-S2) — the delivery times are real instants: on the night
// the clocks go back, the first time offered is the lead away (it was 90 to 105 minutes), and on the night they go
// forward no wall time that does not exist is offered or labelled (« 2 h » named 03:00, so « 2 h 30 » came after
// « 3 h » and the orders sorted wrong). The nights are the next two changes of the Paris clock, computed from today.
const test = require('node:test');
const assert = require('node:assert/strict');

const { deliveryPicker, deliveryTimes, wallClock } = require('../serviceHours');
const { toParisIso } = require('../../../utils/stayWindow');

const DAY = 24 * 60 * 60 * 1000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The next last Sunday of `month` (0-based) from today, as `YYYY-MM-DD`: the night the Paris clock changes. */
function nextChange(month) {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (let year = new Date().getUTCFullYear(); ; year += 1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const sunday = last.getTime() - last.getUTCDay() * DAY;
    if (sunday >= today) return ymd(sunday);
  }
}

const stayAround = (date) => ({
  startDate: ymd(Date.parse(`${date}T00:00:00Z`) - DAY), endDate: ymd(Date.parse(`${date}T00:00:00Z`) + DAY), checkInTime: '16:00', checkOutTime: '10:00',
});
const FREE = { unconstrained: true, weekly: {}, exceptions: [], closures: [] };
// A service open through the night: the constrained path crosses the change too.
const NIGHT = Object.freeze({ unconstrained: false, weekly: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ from: '00:00', to: '23:30' }]])), exceptions: [], closures: [] });

/** Every time offered names its own instant, in time order, 30 minutes apart at least, its label its wall clock. */
function assertCoherent(list) {
  list.forEach((t, i) => {
    assert.deepEqual(wallClock(new Date(t.at)), { date: t.date, minutes: t.minutes }, toParisIso(new Date(t.at)));
    if (i) assert.ok(t.at - list[i - 1].at >= 30 * 60 * 1000, `${toParisIso(new Date(t.at))} after ${toParisIso(new Date(list[i - 1].at))}`);
  });
}

test('rule 41 reading: the night the clocks go back, the first delivery time is the lead away, not 90 minutes', () => {
  const date = nextChange(9);
  const stay = stayAround(date);
  const now = new Date(`${date}T00:30:00Z`);
  const list = deliveryTimes({ now, stay, leadMinutes: 30, schedule: FREE });
  assert.equal(list[0].at - now.getTime(), 30 * 60 * 1000, toParisIso(new Date(list[0].at)));
  assertCoherent(list);
  const eve = ymd(Date.parse(`${date}T00:00:00Z`) - DAY);
  assertCoherent(deliveryTimes({ now: new Date(`${eve}T23:20:00Z`), stay, leadMinutes: 30, schedule: NIGHT }));
  const picker = deliveryPicker({ now, stay, leadMinutes: 30, schedule: FREE, lang: 'fr' });
  assert.equal(Date.parse(picker.asap.at) - now.getTime(), 30 * 60 * 1000, picker.asap.at);
});

test('rule 41 reading: the night the clocks go forward, no wall time that does not exist is offered, and the times keep their order', () => {
  const date = nextChange(2);
  const stay = stayAround(date);
  [FREE, NIGHT].forEach((schedule) => {
    const list = deliveryTimes({ now: new Date(`${date}T00:15:00Z`), stay, leadMinutes: 30, schedule });
    assert.equal(list.some((t) => t.date === date && t.minutes >= 120 && t.minutes < 180), false, 'no 02:xx on that night');
    assertCoherent(list);
  });
  const picker = deliveryPicker({ now: new Date(`${date}T00:15:00Z`), stay, leadMinutes: 30, schedule: FREE, lang: 'fr' });
  const slots = picker.days.flatMap((d) => d.times);
  slots.forEach((slot, i) => { if (i) assert.ok(Date.parse(slot.at) > Date.parse(slots[i - 1].at)); });
  assert.equal(picker.asap.label, 'Dès que possible — vers 3 h');
});
