// specs/pricing-components.md §3 rules 48, 49, 57 — the `hourly-slot` adapter (bathFulfilment) over the planning's availability: an overlapping session is
// refused (SLOT_TAKEN) at reserve and again at confirm, a held slot of another plugin counts, a heat-up is honoured, release leaves the planning as the lines
// make it, and a confirm that runs inside a rolled-back transaction writes nothing. The plugin declares both interfaces and the core hands them out while it is live.
const test = require('node:test');
const assert = require('node:assert/strict');

const { DDL } = require('./hourlySchedulingFixture');
const { createScheduler } = require('../scheduler');
const { createSlotAvailability } = require('../slotAvailability');
const { createBathFulfilment } = require('../bathFulfilment');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const sdk = require('../../sdk');
const fulfilment = require('../../../utils/pricing/articleFulfilment');

const STAY = { startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00' };
const NOW = new Date('2099-07-07T10:00:00+02:00');

function seed(resource = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  const r = { name: 'Bain nordique', price: 30, openTime: '11:00', closeTime: '22:00', heatUpMinutes: 0, heatRetentionMinutes: 0, ...resource };
  const resourceId = Number(db.prepare(`INSERT INTO resources (name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime, hourlyEveningStart,
    hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity) VALUES (@name, @price, 15, 60, 60, @openTime, @closeTime, '20:00', 50, @heatUpMinutes, @heatRetentionMinutes, 1)`).run(r).lastInsertRowid);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, ?, 36)').run(resourceId);
  db.prepare('INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (500, 1, ?, ?, ?, ?)').run(STAY.startDate, STAY.endDate, STAY.checkInTime, STAY.checkOutTime);
  const scheduler = createScheduler(db);
  const adapter = createBathFulfilment({ slotAvailability: createSlotAvailability(() => scheduler) });
  const draft = (sessions) => ({ resourceId, propertyId: 1, stay: STAY, sessions, now: NOW });
  return { db, resourceId, adapter, draft };
}
const session = (start, end, date = '2099-07-07') => ({ date, start, end });

test('rule 49 — a free slot reserves a hold, confirm accepts it, nothing is written by either', () => {
  const { db, adapter, draft } = seed();
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservation_resources').get().n;
  const held = adapter.reserve(draft([session('14:00', '15:00')]));
  assert.match(held.hold.id, /^hourly-slot:/);
  assert.deepEqual(adapter.confirm(held.hold, draft([session('14:00', '15:00')])), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources').get().n, before);
});

test('rule 49 — a slot another stay or an outside booking holds is refused with SLOT_TAKEN, at reserve and again at confirm', () => {
  const { db, resourceId, adapter, draft } = seed();
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, '2099-07-07', '13:00', '14:00', 'Voisin')").run(resourceId);
  const refused = adapter.reserve(draft([session('13:00', '14:00')]));
  assert.equal(refused.refusal.code, 'SLOT_TAKEN');
  assert.equal(refused.refusal.results[0].reason, 'taken');
  const held = adapter.reserve(draft([session('16:00', '17:00')]));
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, '2099-07-07', '16:00', '17:00', 'Voisin')").run(resourceId);
  assert.equal(adapter.confirm(held.hold, draft([session('16:00', '17:00')])).refusal.code, 'SLOT_TAKEN', 'the slot went between the hold and the confirm');
});

test('rule 49 — a slot another plugin holds (an order awaiting its card) counts, and the heat-up is honoured', () => {
  const { resourceId, adapter, draft } = seed({ heatUpMinutes: 120 });
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  try {
    createContext('shop', {}).resourceHolds(({ resourceId: id }) => (Number(id) === Number(resourceId) ? [{ date: '2099-07-07', start: '15:00', end: '16:00' }] : []));
    assert.equal(adapter.reserve(draft([session('15:00', '16:00')])).refusal.code, 'SLOT_TAKEN');
    assert.equal(adapter.reserve(draft([session('11:00', '12:00')])).refusal.results[0].reason, 'heating', 'a cold bath cannot be used before its heat-up is done');
  } finally { registry.reset(); }
});

test('rule 49 — release frees nothing of its own: the planning is what the lines make it', () => {
  const { db, resourceId, adapter, draft } = seed();
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, sessions) VALUES (500, ?, 1, 'per_hour', ?)").run(resourceId, JSON.stringify([session('14:00', '15:00')]));
  assert.equal(adapter.reserve(draft([session('14:00', '15:00')])).refusal.code, 'SLOT_TAKEN');
  adapter.release({ id: 'x' }, 'line cancelled');
  assert.equal(adapter.reserve(draft([session('14:00', '15:00')])).refusal.code, 'SLOT_TAKEN');
  db.prepare('DELETE FROM reservation_resources WHERE reservationId = 500').run();
  assert.ok(adapter.reserve(draft([session('14:00', '15:00')])).hold, 'the line left, the slot is free');
});

test('rule 57 — a confirm inside a transaction that is rolled back leaves nothing', () => {
  const { db, adapter, draft } = seed();
  const rollback = new Error('rolled back');
  assert.throws(() => db.transaction(() => {
    const held = adapter.reserve(draft([session('18:00', '19:00')]));
    assert.deepEqual(adapter.confirm(held.hold, draft([session('18:00', '19:00')])), { ok: true });
    throw rollback;
  })(), rollback);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources').get().n, 0);
  assert.ok(adapter.reserve(draft([session('18:00', '19:00')])).hold, 'the slot is still free');
});

test('rules 48, 49 — hourly-resources declares the slot availability and the fulfilment, and the core hands them out only while it is live', () => {
  registry.reset();
  let live = true;
  registry.configure({ isActive: () => live, allows: () => true });
  try {
    require('..').register(createContext('hourly-resources', { db: null }));
    assert.equal(typeof sdk.core.slotAvailability().validate, 'function');
    assert.equal(typeof sdk.core.slotAvailability().slots, 'function');
    assert.ok(registry.get('hourly-resources').articleFulfilments.includes('hourly-slot'));
    assert.equal(fulfilment.reserve('hourly-slot', { sessions: [] }).hold, null, 'no session placed: no hold');
    live = false;
    assert.equal(sdk.core.slotAvailability(), null);
    assert.deepEqual(fulfilment.reserve('hourly-slot', { resourceId: 1, sessions: [session('14:00', '15:00')] }), { hold: null }, 'inactive: the adapter is not asked');
    assert.throws(() => createContext('other-baths', {}).slotAvailability({ slots() {}, validate() {} }), /already declared by hourly-resources/);
    assert.throws(() => createContext('other-baths', {}).slotAvailability({ slots() {} }), /lacks "validate"/);
  } finally {
    fulfilment.unregister('hourly-slot');
    registry.reset();
  }
});
