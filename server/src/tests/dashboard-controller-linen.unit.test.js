const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');

// Fake the inventory model + reservations model so the controller's HTTP shaping is the
// only thing under test.

function makeFake({ simulate = null, reservations = new Map() } = {}) {
  const calls = { simulate: 0, findById: [] };
  return {
    calls,
    linenInventoryModel: {
      simulate() { calls.simulate += 1; return simulate; },
    },
    reservationsModel: {
      findById(id) { calls.findById.push(id); return reservations.get(Number(id)) || null; },
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('linenShortage: no horizon → empty shortagesByType, no recommendation', () => {
  const fakes = makeFake({ simulate: null });
  const c = buildController(fakes);
  const res = fakeRes();
  c.linenShortage({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { horizon: null, shortagesByType: [] });
});

test('linenShortage: empty shortages → empty list with horizon', () => {
  const fakes = makeFake({
    simulate: {
      horizon: '2026-08-15',
      days: [],
      shortagesByType: {
        single: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        double: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        baby:   { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        large:  { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        medium: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        small:  { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
      },
    },
  });
  const c = buildController(fakes);
  const res = fakeRes();
  c.linenShortage({}, res);
  assert.equal(res.body.horizon, '2026-08-15');
  assert.deepEqual(res.body.shortagesByType, []);
});

test('linenShortage: returns grouped-by-type shortages with resolved client names', () => {
  const fakes = makeFake({
    simulate: {
      horizon: '2026-08-15',
      days: [],
      shortagesByType: {
        single: { firstDate: '2026-06-12', maxMissing: 2, impactedReservationIds: [10, 11] },
        double: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        baby:   { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        large:  { firstDate: '2026-06-12', maxMissing: 4, impactedReservationIds: [10] },
        medium: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        small:  { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
      },
    },
    reservations: new Map([
      [10, { id: 10, firstName: 'Claire', lastName: 'Notin', startDate: '2026-06-12', endDate: '2026-06-15' }],
      [11, { id: 11, firstName: 'Jean', lastName: 'Dupont', startDate: '2026-06-14', endDate: '2026-06-17' }],
    ]),
  });
  const c = buildController(fakes);
  const res = fakeRes();
  c.linenShortage({}, res);

  assert.equal(res.body.horizon, '2026-08-15');
  assert.equal(res.body.shortagesByType.length, 2);
  assert.deepEqual(res.body.shortagesByType[0], {
    type: 'single',
    label: 'Drap simple',
    firstShortageDate: '2026-06-12',
    maxMissing: 2,
    impactedReservations: [
      { id: 10, clientName: 'Claire Notin', startDate: '2026-06-12', endDate: '2026-06-15' },
      { id: 11, clientName: 'Jean Dupont', startDate: '2026-06-14', endDate: '2026-06-17' },
    ],
  });
  assert.deepEqual(res.body.shortagesByType[1], {
    type: 'large',
    label: 'Serviette grande',
    firstShortageDate: '2026-06-12',
    maxMissing: 4,
    impactedReservations: [
      { id: 10, clientName: 'Claire Notin', startDate: '2026-06-12', endDate: '2026-06-15' },
    ],
  });
});

test('linenShortage: missing client falls back to "#<id>"', () => {
  const fakes = makeFake({
    simulate: {
      horizon: '2026-08-15',
      days: [],
      shortagesByType: {
        single: { firstDate: '2026-06-12', maxMissing: 1, impactedReservationIds: [99] },
        double: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        baby:   { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        large:  { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        medium: { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
        small:  { firstDate: null, maxMissing: 0, impactedReservationIds: [] },
      },
    },
    // Empty reservations map — findById returns null for 99.
  });
  const c = buildController(fakes);
  const res = fakeRes();
  c.linenShortage({}, res);
  const reservation = res.body.shortagesByType[0].impactedReservations[0];
  assert.equal(reservation.id, 99);
  assert.equal(reservation.clientName, ''); // fallback — empty, the client should display "#99" if needed
});
