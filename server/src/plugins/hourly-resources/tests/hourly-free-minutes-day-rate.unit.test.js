// specs/hourly-resource-quantity-and-sas-scheduling.md rule 37 (guest-app rule 81) — the free minutes are worth the DAY
// rate: an offered hour placed in the evening owes the evening supplement, as the arrival SAS already bills it.
const test = require('node:test');
const assert = require('node:assert/strict');

const { priceSessions, eveningSupplement } = require('../hourlyPricing');

const CFG = { dayRate: 25, eveningRate: 35, eveningStart: '19:00', slotMinutes: 60 };
const at = (start, end) => [{ date: '2099-07-10', start, end }];

test('rule 37: an offered hour before the evening switch costs nothing', () => {
  const out = priceSessions(at('17:00', '18:00'), CFG, 60);
  assert.deepEqual([out.totalPrice, out.freeValue, out.freeMinutesApplied], [0, 25, 60]);
});

test('rule 37: an offered hour in the evening owes the evening supplement (35 - 25)', () => {
  const out = priceSessions(at('20:00', '21:00'), CFG, 60);
  assert.deepEqual([out.grossPrice, out.freeValue, out.totalPrice], [35, 25, 10]);
});

test('rule 37: a session straddling the switch owes the supplement of its evening part only', () => {
  const out = priceSessions(at('18:00', '20:00'), CFG, 60);
  assert.equal(out.grossPrice, 60);
  assert.equal(out.freeValue, 25);
  assert.equal(out.totalPrice, 35, 'the 19:00 hour at 35');
  const free = priceSessions(at('18:00', '19:00'), CFG, 60);
  assert.equal(free.totalPrice, 0);
});

test('rule 37: the fiche and the SAS say the same — the line plus its evening supplement equals the banded price minus the day-rate free hour', () => {
  const sessions = at('20:00', '22:00');
  const line = priceSessions(sessions, CFG, 60);
  assert.equal(line.totalPrice, 45);
  assert.equal(eveningSupplement(sessions, CFG), 20);
});

test('rule 37: no free minutes — unchanged', () => {
  const out = priceSessions(at('20:00', '21:00'), CFG, 0);
  assert.deepEqual([out.freeValue, out.totalPrice], [0, 35]);
});

test('rule 37: the fiche\'s line leaves the evening supplement of the offered hour to its own charge — a saved line replays its free minutes at 0', () => {
  const { createHourlyContributor } = require('../pricing');
  const resource = { showsPlanningCard: 1, price: 25, hourlyEveningRate: 35, hourlyEveningStart: '19:00', slotDuration: 60, freeMinutes: 60 };
  const line = createHourlyContributor().priceLine({ resource, selected: { sessions: at('20:00', '21:00') }, sold: false });
  assert.deepEqual([line.totalPrice, priceSessions(at('20:00', '21:00'), CFG, 60).freeSupplement], [0, 10]);
  assert.equal(createHourlyContributor().priceLine({ resource, selected: { sessions: at('20:00', '22:00') }, sold: false }).totalPrice, 35, 'the second hour at the evening rate; the free hour\'s supplement is the charge');
});
