// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 29 (K4) — a planning booking of an outside customer may start anywhere: its price is cut where it can change (the evening
// switch, the periods of a Friday or an eve of holiday, each whole hour from the first paid minute), and on every session of the slot grid it is exactly what the engine's quote charges.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const { priceBookingLines } = require('../bookingPricing');
const { quoteSession } = require('../sessionQuote');
const { toMinutes } = require('../hourlyPricing');

const bath = (over = {}) => ({
  id: 1, name: 'Bain', priceType: 'per_hour', showsPlanningCard: 1, price: 30, slotDuration: 60, openTime: '11:00', closeTime: '22:00', hourlyEveningStart: '20:00', hourlyEveningRate: 50,
  hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 50, hourlyExternalNextEveningRate: 70,
  hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendEveningRate: 90, hourlyExternalWeekendNextDayRate: 70, hourlyExternalWeekendNextEveningRate: 90, ...over,
});
const WEDNESDAY = '2027-03-17'; // date-literal-ok: weekdays of a calendar, not "today"
const FRIDAY = '2027-03-19'; // date-literal-ok: a Friday
const SATURDAY = '2027-03-20'; // date-literal-ok: a Saturday
const SUNDAY = '2027-03-21'; // date-literal-ok: a Sunday
const HOLIDAY_EVE = '2027-07-13'; // date-literal-ok: the eve of 14 July
const price = (resource, date, startTime, endTime) => priceBookingLines({ resource, startTime, endTime, external: true, date }).total;

const FIGURES = [
  ['Friday 19:30-21:00 crosses the evening switch and the weekend begins with it', FRIDAY, '19:30', '21:00', 115],
  ['Wednesday 19:30-20:30', WEDNESDAY, '19:30', '20:30', 60],
  ['Wednesday 19:45-20:45', WEDNESDAY, '19:45', '20:45', 65],
  ['the eve of a public holiday: the evening is weekend', HOLIDAY_EVE, '19:30', '21:00', 115],
  ['Saturday 20:30-21:30 (all weekend, one first hour)', SATURDAY, '20:30', '21:30', 90],
  ['Sunday 13:00-14:30 off the grid', SUNDAY, '13:00', '14:30', 105],
];
for (const [name, date, start, end, expected] of FIGURES) {
  test(`${name} = ${expected} €`, () => assert.equal(price(bath(), date, start, end), expected));
}

test('the first hour and the following hours are cut at each whole hour from the paid start, off the grid too', () => {
  const resource = bath({ hourlyExternalNextDayRate: 40, hourlyExternalNextEveningRate: 60 });
  assert.equal(price(resource, WEDNESDAY, '13:15', '15:15'), 50 + 40); // the second hour starts at 14:15
  assert.equal(price(resource, WEDNESDAY, '13:00', '14:30'), 50 + 20);
  assert.equal(price(resource, WEDNESDAY, '19:30', '21:30'), 25 + 35 + 60, 'rank 1 runs 19:30-20:30 across the switch (day then evening first-hour rate), rank 2 after');
});

// Every session of the slot grid: the booking price equals the engine's quote.
const SLOTS = [30, 60];
const DATES = { Wednesday: WEDNESDAY, Friday: FRIDAY, Saturday: SATURDAY, Sunday: SUNDAY, 'eve of a holiday': HOLIDAY_EVE };
for (const slot of SLOTS) {
  for (const [label, date] of Object.entries(DATES)) {
    test(`on the ${slot}-min grid, ${label}: the booking pricer equals the engine on every session`, () => {
      const resource = bath({ slotDuration: slot, hourlyExternalNextDayRate: 45, hourlyExternalNextEveningRate: 63, hourlyExternalWeekendNextDayRate: 60, hourlyExternalWeekendNextEveningRate: 80 });
      let compared = 0;
      for (let start = toMinutes('11:00'); start < toMinutes('22:00'); start += slot) {
        for (let minutes = slot; start + minutes <= toMinutes('22:00'); minutes += slot) {
          const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          const engine = quoteSession({ id: 1, resource, vatClass: 'resources' }, { band: start >= toMinutes('20:00') ? 'evening' : 'day', start: clock(start), minutes, date });
          assert.ok(engine.line, JSON.stringify(engine));
          assert.equal(Math.round(price(resource, date, clock(start), clock(start + minutes)) * 100), engine.line.totalCents, `${date} ${clock(start)}+${minutes}`);
          compared += 1;
        }
      }
      assert.ok(compared > 20);
    });
  }
}
