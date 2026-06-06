const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/planningController');

// specs/breakfast-option-and-planning-card.md §4.3 + §7.1. Pins the controller-level
// shape of the GET /api/planning/breakfast endpoint: from/to validation, 400 codes, and
// payload structure. Model is fully stubbed — its own contract is pinned in
// `breakfast-model.unit.test.js`.

function makeFake({
  breakfastByDateImpl = () => ({}),
} = {}) {
  const calls = [];
  const breakfastModel = {
    breakfastByDate(args) {
      calls.push(args);
      return breakfastByDateImpl(args);
    },
  };
  // The other models are unused by `breakfastSummary` but must exist for the controller
  // to build. Minimal stubs.
  const settingsModel = { read: () => ({ laundryWeekday: 2 }) };
  const laundryModel = {
    dropOffForWindow: () => ({ singleBeds: 0, doubleBeds: 0, babyBeds: 0 }),
    dropOffBathroomForWindow: () => ({ largeTowels: 0, mediumTowels: 0, smallTowels: 0 }),
  };
  const laundryTripSkipsModel = { listAll: () => [] };
  const linenInventoryModel = { simulate: () => null };
  return { breakfastModel, settingsModel, laundryModel, laundryTripSkipsModel, linenInventoryModel, calls };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('breakfastSummary: 200 + payload shape `{ breakfastByDate }` on valid from/to', () => {
  const payload = {
    '2026-06-10': {
      items: [{ reservationId: 1, clientName: 'Dupont', propertyName: 'Gîte', persons: 3 }],
      totalPersons: 3,
    },
  };
  const fakes = makeFake({ breakfastByDateImpl: () => payload });
  const c = buildController(fakes);
  const res = fakeRes();
  c.breakfastSummary({ query: { from: '2026-06-09', to: '2026-06-15' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { breakfastByDate: payload });
  // Args plumbed verbatim to the model.
  assert.deepEqual(fakes.calls[0], { from: '2026-06-09', to: '2026-06-15' });
});

test('breakfastSummary: empty model output → empty `breakfastByDate` payload', () => {
  const fakes = makeFake({ breakfastByDateImpl: () => ({}) });
  const c = buildController(fakes);
  const res = fakeRes();
  c.breakfastSummary({ query: { from: '2026-06-09', to: '2026-06-15' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { breakfastByDate: {} });
});

test('breakfastSummary: malformed `from` → 400 INVALID_DATE_RANGE', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.breakfastSummary({ query: { from: '06/09/2026', to: '2026-06-15' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_DATE_RANGE');
});

test('breakfastSummary: missing `to` → 400 INVALID_DATE_RANGE', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.breakfastSummary({ query: { from: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 400);
});

test('breakfastSummary: from > to → 400 INVALID_DATE_RANGE', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.breakfastSummary({ query: { from: '2026-06-15', to: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 400);
});
