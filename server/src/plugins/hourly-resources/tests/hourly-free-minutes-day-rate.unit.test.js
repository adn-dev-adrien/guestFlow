// specs/hourly-resource-quantity-and-sas-scheduling.md rule 37 — the free minutes are worth the DAY rate: an offered hour placed in the evening owes the evening supplement,
// as the arrival SAS already bills it. `priceSessions` values the allowance at the day rate and names the supplement; the fiche's line leaves that supplement to its own
// charge; a sold line is never re-priced by it.
const test = require('node:test');
const assert = require('node:assert/strict');

const { priceSessions, eveningSupplement } = require('../hourlyPricing');
const { createHourlyContributor } = require('../pricing');

const CFG = { dayRate: 25, eveningRate: 35, eveningStart: '19:00', slotMinutes: 60 };
const at = (start, end) => [{ date: '2099-07-10', start, end }];

test('rule 37: an offered hour before the evening switch costs nothing', () => {
  const out = priceSessions(at('17:00', '18:00'), CFG, 60);
  assert.deepEqual([out.totalPrice, out.freeValue, out.freeMinutesApplied, out.freeSupplement], [0, 25, 60, 0]);
});

test('rule 37: an offered hour in the evening owes the evening supplement (35 - 25)', () => {
  const out = priceSessions(at('20:00', '21:00'), CFG, 60);
  assert.deepEqual([out.grossPrice, out.freeValue, out.totalPrice, out.freeSupplement], [35, 25, 10, 10]);
});

test('rule 37: a session straddling the switch owes the supplement of its evening part only', () => {
  const out = priceSessions(at('18:00', '20:00'), CFG, 60);
  assert.deepEqual([out.grossPrice, out.freeValue, out.totalPrice, out.freeSupplement], [60, 25, 35, 0], 'the free hour is the 18:00 one: the 19:00 hour at 35');
  assert.equal(priceSessions(at('18:00', '19:00'), CFG, 60).totalPrice, 0);
});

test('rule 37: the fiche and the SAS say the same — the line plus the free hour\'s supplement is the banded price less the day-rate free hour', () => {
  const sessions = at('20:00', '22:00');
  const out = priceSessions(sessions, CFG, 60);
  assert.equal(out.totalPrice, 45);
  assert.equal(out.totalPrice, out.grossPrice - out.freeValue);
  assert.equal(eveningSupplement(sessions, CFG), 20, 'the SAS bills the evening of both hours; the line carries one of them');
});

test('rule 37: no free minutes — unchanged; free minutes keep freeMinutesApplied, billedMinutes and bands', () => {
  const none = priceSessions(at('20:00', '21:00'), CFG, 0);
  assert.deepEqual([none.freeValue, none.freeSupplement, none.totalPrice], [0, 0, 35]);
  const out = priceSessions(at('20:00', '22:00'), CFG, 60);
  assert.deepEqual([out.freeMinutesApplied, out.billedMinutes, out.bands.map((b) => b.band)], [60, 60, ['evening']]);
});

test('rule 37: a line with no billed hour but a supplement keeps it as its one unit, so a stored line replays to the same total', () => {
  const out = priceSessions(at('20:00', '21:00'), CFG, 60);
  assert.deepEqual([out.billedHours, out.unitPrice, out.totalPrice], [0, 10, 10]);
});

test('rule 37: the fiche\'s line leaves the supplement of the offered hour to its own charge, and a sold line is not re-priced', () => {
  const resource = { showsPlanningCard: 1, price: 25, hourlyEveningRate: 35, hourlyEveningStart: '19:00', slotDuration: 60, freeMinutes: 60 };
  const contributor = createHourlyContributor();
  const one = contributor.priceLine({ resource, selected: { sessions: at('20:00', '21:00') }, sold: false });
  assert.deepEqual([one.totalPrice, one.unitPrice, one.billedUnits], [0, 0, 0], 'the 10 € is not on the line');
  const two = contributor.priceLine({ resource, selected: { sessions: at('20:00', '22:00') }, sold: false });
  assert.deepEqual([two.totalPrice, two.billedUnits], [35, 1], 'the second hour at the evening rate, as before');
  const sold = contributor.priceLine({ resource, selected: { sessions: at('20:00', '22:00') }, sold: true });
  assert.equal(sold.totalPrice, undefined, 'a sold line is billed by the engine through its lock, never by this rule');
});
