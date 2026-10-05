// Arrival SAS — « Planifier les ressources ».
// specs/hourly-resource-quantity-and-sas-scheduling.md §3.4.
//
// The hours are sold on the quote and placed on real slots with the guest at check-in. This covers
// what the step offers, what it refuses, and what the commit writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./hourlySchedulingFixture');
const { createSasStep } = require('../sasStep');

// A fixed clock well before the stay, so `notBefore` is always the check-in.
const NOW = new Date('2026-09-01T09:00:00Z');
const slotsOn = (payload, resourceId, date) =>
  payload.resources.find((r) => r.resourceId === resourceId).days.find((d) => d.date === date).slots;
const stateAt = (payload, resourceId, date, time) =>
  slotsOn(payload, resourceId, date).find((s) => s.start === time)?.state;

// ── Applicability + hours owed ─────────────────────────────────────────────────────────────────────

test('the step applies while hours are still unplaced', () => {
  const { scheduling, reservation, resourceId } = seed({ hoursSold: 3 });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, true);
  const entry = payload.resources.find((r) => r.resourceId === resourceId);
  assert.deepEqual(
    { sold: entry.hoursSold, placed: entry.hoursPlaced, remaining: entry.hoursRemaining },
    { sold: 3, placed: 0, remaining: 3 },
  );
});

test('the step is skipped once every hour sits on a slot', () => {
  const { scheduling, reservation } = seed({
    hoursSold: 2,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '19:00' }],
  });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, false);
  assert.equal(payload.resources[0].hoursRemaining, 0);
});

test('partially placed hours leave the remainder owed', () => {
  const { scheduling, reservation } = seed({
    hoursSold: 3,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const entry = scheduling.getSchedulingPayload(reservation, { now: NOW }).resources[0];
  assert.equal(entry.hoursPlaced, 1);
  assert.equal(entry.hoursRemaining, 2);
});

test('a reservation with no hourly resource makes the step inapplicable', () => {
  const { scheduling, reservation } = seed({ hoursSold: 0 });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, false);
  assert.deepEqual(payload.resources, []);
});

// ── What the picker offers ─────────────────────────────────────────────────────────────────────────

test('nothing is offered before the guests arrive', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(stateAt(payload, resourceId, '2026-09-11', '15:00'), 'past');
  assert.equal(stateAt(payload, resourceId, '2026-09-11', '16:00'), 'free');
});

test('nothing is offered after the check-out', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  // Check-out is 10:00 on the 14th; the resource opens at 11:00 → the whole departure day is closed.
  assert.ok(slotsOn(payload, resourceId, '2026-09-14').every((s) => s.state === 'closed'));
});

test('a warm-up pushes the first evening back, and a neighbour cancels it', () => {
  const cold = seed({ resource: { heatUpMinutes: 240, heatRetentionMinutes: 480 } });
  const coldPayload = cold.scheduling.getSchedulingPayload(cold.reservation, { now: NOW });
  assert.equal(stateAt(coldPayload, cold.resourceId, '2026-09-11', '17:00'), 'heating');
  assert.equal(stateAt(coldPayload, cold.resourceId, '2026-09-11', '20:00'), 'free');

  // Somebody else used the bath until 14:00 that day → still warm, so 16:00 works.
  const warm = seed({ resource: { heatUpMinutes: 240, heatRetentionMinutes: 480 } });
  warm.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2026-09-11', '13:00', '14:00')").run(warm.resourceId);
  const warmPayload = warm.scheduling.getSchedulingPayload(warm.reservation, { now: NOW });
  const slot = slotsOn(warmPayload, warm.resourceId, '2026-09-11').find((s) => s.start === '16:00');
  assert.equal(slot.state, 'free');
  assert.equal(slot.warm, true);
});

test('the occupancy strip shows the neighbours without naming anyone', () => {
  const { db, scheduling, reservation, resourceId } = seed();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9, 'Camille', 'Dupont')").run();
  db.prepare("INSERT INTO resource_bookings (resourceId, clientId, clientName, date, startTime, endTime) VALUES (?, 9, 'Camille Dupont', '2026-09-12', '14:00', '15:00')").run(resourceId);
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  const day = payload.resources[0].days.find((d) => d.date === '2026-09-12');
  assert.deepEqual(day.occupancy, [{ start: '14:00', end: '15:00' }]);
  assert.ok(!JSON.stringify(payload).includes('Camille'));
});

test("the reservation's own stored hours never block its own picker", () => {
  const { scheduling, reservation, resourceId } = seed({
    hoursSold: 3,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  // Re-opening the SAS must be able to keep or move that block, so 17:00 stays offerable.
  assert.equal(stateAt(payload, resourceId, '2026-09-12', '17:00'), 'free');
});

test('a block placed earlier in the run occupies its slot on the next refresh', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getFreeSlots({
    reservation, resourceId, now: NOW,
    pending: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const slots = payload.days.find((d) => d.date === '2026-09-12').slots;
  assert.equal(slots.find((s) => s.start === '17:00').state, 'taken');
  assert.equal(slots.find((s) => s.start === '19:00').state, 'free');
});

test('getFreeSlots refuses a resource that is not sold on the reservation', () => {
  const { scheduling, reservation } = seed();
  assert.equal(scheduling.getFreeSlots({ reservation, resourceId: 999, now: NOW }), null);
});

// ── Commit-time validation ─────────────────────────────────────────────────────────────────────────

const validate = (ctx, blocks) => ctx.scheduling.validateBlocks({ reservation: ctx.reservation, blocks, now: NOW });

test('a bookable block passes and reports no supplement in the day band', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.supplements, []);
});

test('an evening block owes the band difference', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.supplements[0].amount, 40); // 2 h × (50 − 30)
  assert.match(verdict.supplements[0].label, /Bain nordique/);
});

test('a taken slot is refused, with its reason', () => {
  const ctx = seed();
  ctx.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2026-09-12', '14:00', '15:00')").run(ctx.resourceId);
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'taken');
});

test('two blocks in the same payload cannot overlap each other', () => {
  const ctx = seed();
  const verdict = validate(ctx, [
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
  ]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'taken');
});

test('more hours than were sold are refused', () => {
  const ctx = seed({ hoursSold: 2 });
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '18:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'budget');
});

test('the budget spans the payload, not each block', () => {
  const ctx = seed({ hoursSold: 2 });
  const blocks = [
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-13', start: '16:00', end: '17:00' }, // the 3rd hour
  ];
  assert.equal(validate(ctx, blocks.slice(0, 2)).ok, true);
  assert.equal(validate(ctx, blocks).reason, 'budget');
});

test('re-placing hours on a reservation that already has sessions uses the FULL sold budget', () => {
  // Re-opening a completed SAS must be able to MOVE a block, not just add to the remainder.
  const ctx = seed({ hoursSold: 2, sessions: [{ date: '2026-09-12', start: '17:00', end: '19:00' }] });
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '16:00' }]);
  assert.equal(verdict.ok, true);
});

test('a resource not sold on the reservation is refused', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: 999, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'unknown');
});

// ── What the commit writes ─────────────────────────────────────────────────────────────────────────

// The step's write runs inside the core commit (specs/plugins-phase-3c-hourly-resources.md rule 6).
const writeStep = (ctx, blocks) => ctx.reservations.commitArrivalSas(500, {
  pluginWrites: [(db) => createSasStep({ scheduling: () => ctx.scheduling, reservations: {} }).hook
    .write(db, ctx.reservation, { blocks, resourceIds: [ctx.resourceId] })],
});

function storedSessions(ctx) {
  const row = ctx.db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = 500 AND resourceId = ?').get(ctx.resourceId);
  return JSON.parse(row.sessions || 'null');
}

test('the commit writes the placed blocks as sessions, ordered', () => {
  const ctx = seed();
  writeStep(ctx, [
    { resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '21:00' },
  ]);
  assert.deepEqual(storedSessions(ctx), [
    { date: '2026-09-12', start: '20:00', end: '21:00' },
    { date: '2026-09-13', start: '14:00', end: '15:00' },
  ]);
});

test('the commit REPLACES the sessions instead of appending to them', () => {
  const ctx = seed({ sessions: [{ date: '2026-09-12', start: '11:00', end: '12:00' }] });
  writeStep(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' }]);
  assert.deepEqual(storedSessions(ctx), [{ date: '2026-09-13', start: '14:00', end: '15:00' }]);
});

test('skipping the step writes nothing — the stored hours stay as they were', () => {
  const before = [{ date: '2026-09-12', start: '11:00', end: '12:00' }];
  const ctx = seed({ sessions: before });
  ctx.reservations.commitArrivalSas(500, { cautionReceived: true });
  assert.deepEqual(storedSessions(ctx), before);
});

test('the evening supplement lands in the arrival complement as a SAS line', () => {
  const ctx = seed();
  const amount = ctx.scheduling
    .validateBlocks({ reservation: ctx.reservation, blocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }], now: NOW })
    .supplements[0].amount;
  const complement = ctx.reservations.commitArrivalSas(500, {
    complementItems: [{ label: 'Bain nordique — supplément soirée', amount }],
  });
  assert.equal(complement, 40);
  const rows = ctx.db.prepare('SELECT description, amount, inComplement, sasArrivalOrigin FROM reservation_custom_options WHERE reservationId = 500').all();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { amount: rows[0].amount, inComplement: rows[0].inComplement, sasOrigin: rows[0].sasArrivalOrigin },
    { amount: 40, inComplement: 1, sasOrigin: 1 },
  );
});

test('re-committing recomputes the supplement instead of stacking it', () => {
  const ctx = seed();
  const args = {
    complementItems: [{ label: 'Bain nordique — supplément soirée', amount: 40 }],
  };
  ctx.reservations.commitArrivalSas(500, args);
  const second = ctx.reservations.commitArrivalSas(500, args);
  assert.equal(second, 40, 'a second run must not double the supplement');

  // Moving the block into the day band removes the supplement entirely.
  const third = ctx.reservations.commitArrivalSas(500, {
    complementItems: [],
  });
  assert.equal(third, 0);
});
