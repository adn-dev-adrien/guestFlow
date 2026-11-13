// specs/hourly-resource-quantity-and-sas-scheduling.md rule 36 (guest-app rule 79) — `heatFrom`: the cold path of the
// thermal model is `start >= heatFrom + heatUpMinutes`, counted from the present moment when the guest app asks, while
// `notBefore` still bounds every start. Absent, it is `notBefore`: the SAS and the fiche answer as before.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDays, validateBlock, toAbsMinutes } = require('../availability');
const { DDL } = require('./hourlySchedulingFixture');
const { createScheduler } = require('../scheduler');

const BATH = {
  slotDuration: 60, minimumUsageMinutes: 60, openTime: '11:00', closeTime: '22:00', openDays: '[0,1,2,3,4,5,6]', closedDays: '[]',
  heatUpMinutes: 240, heatRetentionMinutes: 120, turnoverMinutes: 0, quantity: 1, price: 30,
};
const abs = (date, time) => toAbsMinutes(date, time);
const stateOf = (days, date, start) => days.find((d) => d.date === date).slots.find((s) => s.start === start).state;

test('rule 36: without heatFrom the arrival day is heating until check-in + heat-up (the SAS reading, unchanged)', () => {
  const days = buildDays({ resource: BATH, stayDates: ['2099-07-06'], notBefore: abs('2099-07-06', '16:00') });
  assert.equal(stateOf(days, '2099-07-06', '19:00'), 'heating');
  assert.equal(stateOf(days, '2099-07-06', '20:00'), 'free');
});

test('rule 36: a week ahead, heatFrom = now offers the arrival evening right after the check-in', () => {
  const days = buildDays({
    resource: BATH, stayDates: ['2099-07-06'], notBefore: abs('2099-07-06', '16:00'), heatFrom: abs('2099-06-29', '10:00'),
  });
  assert.equal(stateOf(days, '2099-07-06', '16:00'), 'free');
  assert.equal(stateOf(days, '2099-07-06', '12:00'), 'past', 'check-in still bounds every start');
});

test('rule 36: on the day, at 17 h with a 4 h heat-up, the first cold slot is 21 h', () => {
  const now = abs('2099-07-06', '17:00');
  const days = buildDays({ resource: BATH, stayDates: ['2099-07-06'], notBefore: now, heatFrom: now });
  assert.equal(stateOf(days, '2099-07-06', '20:00'), 'heating');
  assert.equal(stateOf(days, '2099-07-06', '21:00'), 'free');
});

test('rule 36: a slot warm from an adjacent booking is offered at once, heatFrom or not', () => {
  const now = abs('2099-07-06', '17:00');
  const days = buildDays({
    resource: BATH, stayDates: ['2099-07-06'], occupancy: [{ date: '2099-07-06', start: '17:00', end: '18:00' }], notBefore: now, heatFrom: now,
  });
  assert.equal(stateOf(days, '2099-07-06', '19:00'), 'free', 'ends at 18:00, retention 120 min');
  assert.equal(stateOf(days, '2099-07-06', '21:00'), 'free');
});

test('rule 36: validateBlock refuses a cold slot sooner than heatFrom + heat-up and accepts it counted from a week ahead', () => {
  const block = { date: '2099-07-06', start: '17:00', end: '18:00' };
  const now = abs('2099-07-06', '16:00');
  assert.deepEqual(validateBlock({ resource: BATH, block, notBefore: now, heatFrom: now }), { ok: false, reason: 'heating' });
  assert.deepEqual(validateBlock({ resource: BATH, block, notBefore: now, heatFrom: abs('2099-06-29', '10:00') }), { ok: true });
  assert.deepEqual(validateBlock({ resource: BATH, block, notBefore: now }), { ok: false, reason: 'heating' }, 'absent: notBefore');
});

test('rule 36: the scheduler counts the heat-up from the heatFrom instant it is given, and offers the bath hours and bands', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  db.prepare(`INSERT INTO resources (id, name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime, hourlyEveningStart,
    hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity, openDays, closedDays)
    VALUES (1, 'Bain nordique', 30, 0, 60, 60, '11:00', '22:00', '19:00', 40, 240, 120, 1, '[0,1,2,3,4,5,6]', '[]')`).run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, 1, 30)').run();
  const scheduler = createScheduler(db);
  const stay = { startDate: '2099-07-13', endDate: '2099-07-15', checkInTime: '16:00', checkOutTime: '10:00' };
  const week = new Date('2099-07-06T10:00:00+02:00');
  const ahead = scheduler.slotsForStay({ resourceId: 1, propertyId: 1, stay, now: week, heatFrom: week });
  const arrival = ahead.days.find((d) => d.date === '2099-07-13');
  assert.equal(arrival.slots.find((s) => s.start === '16:00').state, 'free');
  assert.equal(arrival.slots.find((s) => s.start === '19:00').band, 'evening');
  assert.equal(arrival.slots.find((s) => s.start === '19:00').supplement, 10);
  assert.equal(arrival.slots.find((s) => s.start === '17:00').band, 'day');
  assert.deepEqual(ahead.opening, { from: '11:00', to: '22:00' });
  const onTheDay = new Date('2099-07-13T17:00:00+02:00');
  const same = scheduler.slotsForStay({ resourceId: 1, propertyId: 1, stay, now: onTheDay, heatFrom: onTheDay });
  assert.equal(same.days.find((d) => d.date === '2099-07-13').slots.find((s) => s.start === '20:00').state, 'heating');
  assert.equal(same.days.find((d) => d.date === '2099-07-13').slots.find((s) => s.start === '21:00').state, 'evening');
  const verdict = scheduler.validateSessions({ resourceId: 1, propertyId: 1, stay, now: onTheDay, heatFrom: onTheDay, sessions: [{ date: '2099-07-13', start: '19:00', end: '20:00' }] });
  assert.deepEqual([verdict.ok, verdict.results[0].reason], [false, 'heating']);
});
