// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 28, 29, 30 (K2-K4) — an outside band with no first-hour price is not sold on EVERY placed path (never 0 €, never
// another rate); a booking that carries a lodging keeps the week grid and its free hour; an outside planning session is priced by the hourly engine off the slot grid too.
const test = require('node:test');
const assert = require('node:assert/strict');

const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { priceBookingLines } = optionalPlugin(() => require('../plugins/hourly-resources/bookingPricing'));
const { quoteSession, sessionModesOf, isOfferedOnline } = optionalPlugin(() => require('../plugins/hourly-resources/sessionQuote'));
const NEEDS_PLUGIN = { skip: skipWithout(['hourly-resources']) };

// The production bath of the price-gate snapshot with the owner's values (D4): week 50 / 70, weekend 70 / 90, slot 60 min, evening from 20:00.
const BATH = {
  id: 2, name: 'Bain nordique', priceType: 'per_hour', showsPlanningCard: 1, sellableExternally: 1, price: 30, slotDuration: 60, openTime: '11:00', closeTime: '22:00', minimumUsageMinutes: 60,
  hourlyEveningStart: '20:00', hourlyEveningRate: 50, hourlyNextDayRate: 30, hourlyNextEveningRate: 50,
  hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 50, hourlyExternalNextEveningRate: 70,
  hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendEveningRate: 90, hourlyExternalWeekendNextDayRate: 70, hourlyExternalWeekendNextEveningRate: 90,
};
const FREE_HOUR = { price: null, freeMinutes: 60 };
const SATURDAY = '2026-11-28'; // date-literal-ok: a calendar fact, the day of the week is what is under test
const WEDNESDAY = '2026-11-25'; // date-literal-ok: a calendar fact, the day of the week is what is under test
const config = (resource) => ({ id: 2, resource, vatClass: 'resources' });
const engine = (resource, session) => quoteSession(config(resource), session);

test('K3 — a booking that carries a lodging keeps the week grid: the 11 Nov snapshot bookings #1, #2 (Saturday morning, 0 €) and #4 (Saturday 21:00) keep their figures', NEEDS_PLUGIN, () => {
  const price = (startTime, endTime) => priceBookingLines({
    resource: BATH, startTime, endTime, override: FREE_HOUR, external: true, date: null, lodging: true,
  });
  assert.equal(price('09:00', '10:00').total, 0, '#1');
  assert.equal(price('11:00', '12:00').total, 0, '#2');
  assert.equal(price('21:00', '22:00').total, 20, '#4: the evening hour at 70, its free hour valued at the day rate 50');
});

test('F4 — the same Saturday hour without a lodging is a weekend hour (70 €)', NEEDS_PLUGIN, () => {
  const out = priceBookingLines({ resource: BATH, startTime: '11:00', endTime: '12:00', external: true, date: SATURDAY });
  assert.equal(out.total, 70);
});

test('K4 — an outside session off the slot grid costs what the engine charges on its grid: Saturday 20:30-21:30 is a weekend evening hour', NEEDS_PLUGIN, () => {
  const planning = priceBookingLines({ resource: BATH, startTime: '20:30', endTime: '21:30', external: true, date: SATURDAY });
  assert.equal(planning.pricing, 'banded');
  assert.equal(planning.total, 90);
  const onGrid = engine(BATH, { band: 'evening', start: '20:00', minutes: 60, date: SATURDAY });
  assert.equal(onGrid.line.totalCents, 9000, 'the engine\'s own figure on the grid');
  const sunday = priceBookingLines({ resource: BATH, startTime: '13:00', endTime: '14:30', external: true, date: '2026-11-29' }); // date-literal-ok: a Sunday
  assert.equal(sunday.pricing, 'banded');
  assert.equal(sunday.total, 105, 'production booking #6, an outside Sunday 13:00-14:30, no longer billed at the guests\' 30 €');
});

test('F3 — an outside band with no first-hour price is refused with a sentence on the planning path, never priced 0 €', NEEDS_PLUGIN, () => {
  const noWeekendDay = { ...BATH, hourlyExternalWeekendDayRate: 0 };
  const refused = priceBookingLines({ resource: noWeekendDay, startTime: '14:00', endTime: '15:00', external: true, date: SATURDAY });
  assert.equal(refused.refusal, '« Bain nordique » n’a pas de tarif extérieur pour la journée le week-end.');
  assert.equal(priceBookingLines({ resource: noWeekendDay, startTime: '14:00', endTime: '15:00', external: true, date: WEDNESDAY }).refusal, undefined, 'the week day stays sold');
  const nullEvening = { ...BATH, hourlyExternalEveningRate: null };
  assert.match(priceBookingLines({ resource: nullEvening, startTime: '20:00', endTime: '21:00', external: true, date: WEDNESDAY }).refusal, /pour la soirée en semaine\.$/);
  assert.match(priceBookingLines({ resource: nullEvening, startTime: '19:00', endTime: '21:00', external: true, date: WEDNESDAY }).refusal, /pour la soirée en semaine\.$/, 'a day session run into the unsold evening');
  assert.equal(priceBookingLines({ resource: nullEvening, startTime: '20:00', endTime: '21:00', external: true, date: WEDNESDAY, judgeBands: false }).refusal, undefined, 'a booking already stored is not judged again');
});

test('F3 — the engine refuses the same bands, dated or not, and never takes the day rate for an unpriced evening', NEEDS_PLUGIN, () => {
  const noWeekendDay = { ...BATH, hourlyExternalWeekendDayRate: null };
  assert.equal(engine(noWeekendDay, { band: 'day', start: '14:00', minutes: 60, date: SATURDAY }).refusal.code, 'SESSION_BAND_NOT_SOLD');
  assert.equal(engine(noWeekendDay, { band: 'day', minutes: 60, period: 'weekend' }).refusal.code, 'SESSION_BAND_NOT_SOLD');
  assert.equal(engine(noWeekendDay, { band: 'day', start: '14:00', minutes: 60, date: WEDNESDAY }).line.totalCents, 5000);
  const noEvening = { ...BATH, hourlyExternalEveningRate: 0, hourlyExternalWeekendEveningRate: 0 };
  assert.equal(engine(noEvening, { band: 'evening', start: '20:00', minutes: 60, date: WEDNESDAY }).refusal.code, 'SESSION_BAND_NOT_SOLD');
  assert.equal(engine(noEvening, { band: 'day', start: '19:00', minutes: 120, date: WEDNESDAY }).refusal.code, 'SESSION_BAND_NOT_SOLD', 'a day session run into the evening');
});

test('F3 — sellability reads both periods: a resource sold only on weekends is offered, its cheapest price is the weekend one', NEEDS_PLUGIN, () => {
  const weekendOnly = {
    ...BATH, hourlyExternalDayRate: null, hourlyExternalEveningRate: null, hourlyExternalNextDayRate: null, hourlyExternalNextEveningRate: null,
  };
  assert.equal(isOfferedOnline(weekendOnly), true);
  const modes = sessionModesOf(weekendOnly, { period: 'any' });
  assert.deepEqual(modes.map((m) => [m.band, m.sellable, m.rateCents]), [['day', true, 7000], ['evening', true, 9000]]);
  const none = { ...weekendOnly, hourlyExternalWeekendDayRate: 0, hourlyExternalWeekendEveningRate: 0 };
  assert.equal(isOfferedOnline(none), false);
  assert.match(sessionModesOf(none, { period: 'any' })[0].reason, /n’a pas de tarif extérieur pour la journée/);
});
