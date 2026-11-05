// specs/guest-app.md rules 28-31, 35 — the resource scheduler hourly-resources declares (SDK 2.22.0): the slots of
// a stay read from the resource planning (other stays, outside bookings, held orders, turnover, capacity, heat-up and
// retention, closed days, evening rate), the check of a multi-slot request, and the holds every planning reader sees.
// The clock is injected, the stay is in 2099; the outside-booking writes date themselves from today (date window).
const test = require('node:test');
const assert = require('node:assert/strict');

const { DDL } = require('./hourlySchedulingFixture');
const { createScheduler } = require('../scheduler');
const bookingsModel = require('../bookingsModel');
const schedulingModel = require('../schedulingModel');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const sdk = require('../../sdk');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const STAY = { startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00' };
const NOW = new Date('2099-07-07T10:00:00+02:00');

/** Bain nordique, 11:00-22:00, 1 h slots, 30 €/h, 50 €/h from 20:00, 15 min reset — lodging 1 pays 36 €/h. */
function seed(resource = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva')").run();
  const r = {
    name: 'Bain nordique', price: 30, turnoverMinutes: 15, minimumUsageMinutes: 60, slotDuration: 60, openTime: '11:00', closeTime: '22:00',
    hourlyEveningStart: '20:00', hourlyEveningRate: 50, heatUpMinutes: 0, heatRetentionMinutes: 0, quantity: 1, openDays: '[0,1,2,3,4,5,6]', closedDays: '[]', ...resource,
  };
  const resourceId = Number(db.prepare(`
    INSERT INTO resources (name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime, hourlyEveningStart,
      hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity, openDays, closedDays)
    VALUES (@name, @price, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @openTime, @closeTime, @hourlyEveningStart,
      @hourlyEveningRate, @heatUpMinutes, @heatRetentionMinutes, @quantity, @openDays, @closedDays)
  `).run(r).lastInsertRowid);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, ?, 36)').run(resourceId);
  const stay = (id, propertyId, dates = STAY) => db.prepare(`
    INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, propertyId, dates.startDate, dates.endDate, dates.checkInTime, dates.checkOutTime);
  stay(500, 1);
  const sessionsOn = (reservationId, sessions, quantity = sessions.length) => db.prepare(`
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, sessions) VALUES (?, ?, ?, 'per_hour', ?)
  `).run(reservationId, resourceId, quantity, JSON.stringify(sessions));
  return { db, resourceId, scheduler: createScheduler(db), stay, sessionsOn };
}

const slotsOf = (result, date) => result.days.find((d) => d.date === date).slots;
const stateAt = (result, date, start) => (slotsOf(result, date).find((s) => s.start === start) || {}).state;
const slots = (ctx, over = {}) => ctx.scheduler.slotsForStay({ resourceId: ctx.resourceId, propertyId: 1, stay: STAY, now: NOW, ...over });

/** A live plugin holding the given sessions, as guest-app does for an order awaiting payment. */
function holding(sessions) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('guest-app', {}).resourceHolds(({ resourceId, from, to }) => sessions
    .filter((s) => Number(s.resourceId) === Number(resourceId) && s.date >= from && s.date <= to));
  return () => registry.reset();
}

test('rule 28: the scheduler is declared by hourly-resources and handed out by the core only while it is live', () => {
  registry.reset();
  let live = true;
  registry.configure({ isActive: () => live, allows: () => true });
  try {
    require('..').register(createContext('hourly-resources', { db: null }));
    assert.equal(typeof sdk.core.resourceScheduler().slotsForStay, 'function');
    assert.equal(typeof sdk.core.resourceScheduler().validateSessions, 'function');
    live = false;
    assert.equal(sdk.core.resourceScheduler(), null, 'inactive: no hourly item can be sold');
    assert.throws(() => createContext('other-baths', {}).resourceScheduler({ slotsForStay() {}, validateSessions() {} }), /already declared by hourly-resources/);
    assert.throws(() => createContext('other-baths', {}).resourceScheduler({ slotsForStay() {} }), /lacks "validateSessions"/);
    assert.throws(() => createContext('other-baths', {}).resourceHolds(null), /needs a function/);
  } finally {
    registry.reset();
  }
});

test('rule 28: a session of another stay and the stay’s own sessions take their slot; no identity leaves', () => {
  const ctx = seed();
  ctx.stay(600, 2, { ...STAY, startDate: '2099-07-05' });
  ctx.sessionsOn(600, [{ date: '2099-07-07', start: '15:00', end: '16:00' }]);
  ctx.sessionsOn(500, [{ date: '2099-07-08', start: '12:00', end: '13:00' }]);
  const result = slots(ctx);
  assert.equal(stateAt(result, '2099-07-07', '15:00'), 'taken');
  assert.equal(stateAt(result, '2099-07-07', '16:00'), 'taken', 'the 15 min reset of the 15:00 use');
  assert.equal(stateAt(result, '2099-07-08', '12:00'), 'taken', 'an order adds to the stay’s sessions, it never replaces them');
  const slot = slotsOf(result, '2099-07-07')[0];
  assert.deepEqual(Object.keys(slot).sort(), ['end', 'price', 'start', 'state']);
});

test('rule 28: an outside booking takes its slot, the reset end is offered off the grid', () => {
  const ctx = seed();
  ctx.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, '2099-07-07', '13:00', '14:00', 'Voisin')").run(ctx.resourceId);
  const day = slotsOf(slots(ctx), '2099-07-07');
  assert.equal(day.find((s) => s.start === '13:00').state, 'taken');
  assert.equal(day.find((s) => s.start === '14:00').state, 'taken', 'inside the reset');
  assert.equal(day.find((s) => s.start === '14:15').state, 'free', 'the moment the reset ends');
});

test('rule 28: capacity — two units leave the slot free beside one use', () => {
  const ctx = seed({ quantity: 2 });
  ctx.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2099-07-07', '13:00', '14:00')").run(ctx.resourceId);
  assert.equal(stateAt(slots(ctx), '2099-07-07', '13:00'), 'free');
});

test('rule 28: the past, check-in and check-out bound the slots; a closed day is closed', () => {
  const ctx = seed({ closedDays: '["2099-07-08"]' });
  const result = slots(ctx);
  assert.equal(stateAt(result, '2099-07-07', '11:00'), 'free', '10:00 now');
  assert.equal(stateAt(slots(ctx, { now: new Date('2099-07-07T15:30:00+02:00') }), '2099-07-07', '14:00'), 'past');
  assert.equal(stateAt(result, '2099-07-06', '15:00'), 'past', 'before the check-in');
  assert.equal(result.days.find((d) => d.date === '2099-07-08').closed, true);
  assert.ok(slotsOf(result, '2099-07-08').every((s) => s.state === 'closed'));
  assert.ok(slotsOf(result, '2099-07-09').every((s) => s.state === 'closed'), 'after the 10:00 check-out');
});

test('rule 28: the evening rate — a slot reaching 20:00 is « evening », priced at the lodging’s rates', () => {
  const ctx = seed();
  const day = slotsOf(slots(ctx), '2099-07-07');
  assert.deepEqual(day.find((s) => s.start === '18:00'), { start: '18:00', end: '19:00', state: 'free', price: 36 });
  assert.deepEqual(day.find((s) => s.start === '20:00'), { start: '20:00', end: '21:00', state: 'evening', price: 50 });
  const estiva = ctx.scheduler.slotsForStay({ resourceId: ctx.resourceId, propertyId: 2, stay: STAY, now: NOW });
  assert.equal(slotsOf(estiva, '2099-07-07').find((s) => s.start === '18:00').price, 30, 'the base price elsewhere');
  assert.equal(ctx.scheduler.slotsForStay({ resourceId: 999, propertyId: 1, stay: STAY, now: NOW }), null);
});

test('rule 31: heat-up from now is « heating »; a cold slot is « staff » when no one can light it; a warm one is not constrained', () => {
  const ctx = seed({ heatUpMinutes: 120, heatRetentionMinutes: 60 });
  ctx.sessionsOn(500, [{ date: '2099-07-07', start: '15:00', end: '16:00' }]);
  const nobody = () => false;
  const result = slots(ctx, { canIgnite: nobody });
  assert.equal(stateAt(result, '2099-07-07', '11:00'), 'heating', 'lit at 10:00 now, warm at 12:00');
  assert.equal(stateAt(result, '2099-07-07', '13:00'), 'staff', 'cold, lit at 11:00: nobody there');
  assert.equal(stateAt(result, '2099-07-07', '17:00'), 'free', 'warm: the 15:00 use ended 16:00, reset 16:15, within the hour kept');
  assert.equal(stateAt(result, '2099-07-07', '19:00'), 'staff', 'cold again three hours later');
  const lit = [];
  const atNine = ({ date, time }) => { lit.push(`${date} ${time}`); return time >= '09:00' && time <= '20:00'; };
  const withStaff = slots(ctx, { canIgnite: atNine });
  assert.equal(stateAt(withStaff, '2099-07-07', '13:00'), 'free');
  assert.ok(lit.includes('2099-07-07 11:00'), 'asked at start − heatUpMinutes, as the ignition card computes it');
  assert.equal(stateAt(withStaff, '2099-07-08', '11:00'), 'free', 'lit at 09:00 the same morning');
  assert.equal(stateAt(slots(ctx), '2099-07-07', '13:00'), 'free', 'no predicate: the operator lights it');
});

test('rule 29: a multi-slot request — each session occupies and warms for the next; one refused leaves the next re-checked cold', () => {
  const ctx = seed({ heatUpMinutes: 120, heatRetentionMinutes: 60, turnoverMinutes: 0 });
  const canIgnite = ({ time }) => time === '14:00';
  const check = (sessions) => ctx.scheduler.validateSessions({ resourceId: ctx.resourceId, propertyId: 1, stay: STAY, sessions, now: NOW, canIgnite });
  const later = { date: '2099-07-07', start: '17:00', end: '18:00' };
  const first = { date: '2099-07-07', start: '16:00', end: '17:00' };
  assert.deepEqual(check([later, first]), { ok: true, results: [{ ...later, ok: true }, { ...first, ok: true }] }, 'in time order, whatever the cart order');
  assert.deepEqual(check([later]).results, [{ ...later, ok: false, reason: 'staff' }], 'without the 16:00 use it is cold, lit at 15:00');
  ctx.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2099-07-07', '16:00', '17:00')").run(ctx.resourceId);
  const taken = check([first, later]);
  assert.equal(taken.results[0].reason, 'taken');
  assert.equal(taken.results[1].ok, true, 'warm thanks to the outside booking, which is real');
  const overlap = check([{ date: '2099-07-08', start: '16:00', end: '17:00' }, { date: '2099-07-08', start: '16:00', end: '17:00' }]);
  assert.deepEqual(overlap.results.map((r) => r.reason), [undefined, 'taken'], 'two sessions of one request cannot share one unit');
  assert.equal(check([{ date: '2099-07-07', start: '16:30', end: '17:00' }]).results[0].reason, 'duration');
});

test('rule 35: a held slot is taken for the guest app, the SAS picker, the planning and an outside booking', () => {
  const ctx = seed();
  const day = addDaysToIsoDate(todayIso(), 30);
  const dates = { startDate: addDaysToIsoDate(day, -1), endDate: addDaysToIsoDate(day, 2), checkInTime: '16:00', checkOutTime: '10:00' };
  ctx.stay(600, 1, dates);
  ctx.sessionsOn(600, [], 2);
  const release = holding([{ resourceId: ctx.resourceId, date: day, start: '14:00', end: '15:00', reservationId: 500 }]);
  try {
    const now = new Date(`${dates.startDate}T08:00:00Z`);
    const guest = ctx.scheduler.slotsForStay({ resourceId: ctx.resourceId, propertyId: 1, stay: dates, now });
    assert.equal(stateAt(guest, day, '14:00'), 'taken');
    const sas = schedulingModel.create(ctx.db).getFreeSlots({ reservation: { id: 600, propertyId: 1, ...dates }, resourceId: ctx.resourceId, now });
    assert.equal(sas.days.find((d) => d.date === day).slots.find((s) => s.start === '14:00').state, 'taken', 'held for its own stay too');
    const bookings = bookingsModel.create(ctx.db);
    const planning = bookings.listForResource({ resourceId: ctx.resourceId, date: day }).find((b) => b.held);
    assert.equal(planning.displayName, 'Commande en attente de paiement');
    assert.equal(planning.kind, 'session', 'read-only on the planning: it opens the fiche');
    assert.equal(planning.reservationId, 500);
    assert.equal(bookings.createBooking({ resourceId: ctx.resourceId, date: day, startTime: '14:00', endTime: '15:00', propertyId: 1 }).status, 409);
  } finally {
    release();
  }
  assert.equal(stateAt(ctx.scheduler.slotsForStay({ resourceId: ctx.resourceId, propertyId: 1, stay: dates, now: new Date(`${dates.startDate}T08:00:00Z`) }), day, '14:00'), 'free',
    'no live holds source: nothing changes');
});
