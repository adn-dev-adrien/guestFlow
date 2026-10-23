// specs/public-api.md rule 8 — the public stay dates are bounded before any engine call: no start in
// the past (the accommodations' day), at most MAX_STAY_NIGHTS nights, no end beyond
// MAX_BOOKING_HORIZON_DAYS. An unbounded endDate (9999-12-31) used to walk millions of nights
// synchronously and block the server, on /quote and /booking-requests alike.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const {
  validateStayInput, MAX_STAY_NIGHTS, MAX_BOOKING_HORIZON_DAYS,
} = require('../publicInputValidation');

const TODAY = '2026-10-23';
const stay = (startDate, endDate) => ({ propertyId: 1, startDate, endDate, adults: 2 });
const fieldsOf = (result) => (result.errors || []).map((e) => `${e.field}: ${e.issue}`);

test('the bounds are the documented ones', () => {
  assert.equal(MAX_STAY_NIGHTS, 365);
  assert.equal(MAX_BOOKING_HORIZON_DAYS, 730);
});

test('a stay starting today is accepted', () => {
  assert.equal(validateStayInput(stay(TODAY, '2026-10-25'), { todayIso: TODAY }).ok, true);
});

test('a stay starting yesterday is refused with the validation shape', () => {
  const r = validateStayInput(stay('2026-10-22', '2026-10-25'), { todayIso: TODAY });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ field: 'startDate', issue: 'must not be in the past' }]);
});

test('endDate 9999-12-31 is refused without walking the stay', () => {
  const r = validateStayInput(stay('2026-11-01', '9999-12-31'), { todayIso: TODAY });
  assert.equal(r.ok, false);
  assert.deepEqual(fieldsOf(r), [
    `endDate: stay must not exceed ${MAX_STAY_NIGHTS} nights`,
    `endDate: must be within ${MAX_BOOKING_HORIZON_DAYS} days from today`,
  ]);
});

test('exactly MAX_STAY_NIGHTS nights is accepted, one more is refused', () => {
  assert.equal(validateStayInput(stay('2027-01-01', '2028-01-01'), { todayIso: TODAY }).ok, true); // 365 nights
  const r = validateStayInput(stay('2027-01-01', '2028-01-02'), { todayIso: TODAY });
  assert.deepEqual(fieldsOf(r), [`endDate: stay must not exceed ${MAX_STAY_NIGHTS} nights`]);
});

test('the stay length is capped even when no day is injected', () => {
  assert.equal(validateStayInput(stay('2027-01-01', '9999-12-31')).ok, false);
});

test('an end on the horizon is accepted, one day past it is refused', () => {
  assert.equal(validateStayInput(stay('2028-10-15', '2028-10-22'), { todayIso: TODAY }).ok, true); // 730 days
  const r = validateStayInput(stay('2028-10-16', '2028-10-23'), { todayIso: TODAY });
  assert.deepEqual(fieldsOf(r), [`endDate: must be within ${MAX_BOOKING_HORIZON_DAYS} days from today`]);
});

// Both public controllers apply the bounds with the accommodations' day, before any engine call.
require('../../../utils/reservationHelpers').getTodayIsoDate = () => TODAY;

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

const engineCalls = [];
const ENGINE_MOCKS = {
  '../../database': { transaction: (fn) => fn, prepare: () => ({ get: () => ({}), all: () => [], run: () => ({}) }) },
  '../../utils/pricing': { calculateReservationQuote: (input) => { engineCalls.push(input); return {}; } },
  './publicQuoteController': {
    buildEngineQuote: (input) => { engineCalls.push(input); return {}; },
    checkOptionApplicability: () => null,
    checkResourceApplicability: () => null,
  },
};

function load(mod) {
  return withMocks(ENGINE_MOCKS, () => {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  });
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

const guest = { firstName: 'Jo', lastName: 'Martin', email: 'jo@example.com', phone: '0612' };

for (const [label, body] of [
  ['a start in the past', stay('2026-10-01', '2026-10-04')],
  ['an endDate of 9999-12-31', stay('2026-11-01', '9999-12-31')],
]) {
  test(`POST /quote refuses ${label} with 422 VALIDATION_FAILED, the engine untouched`, async () => {
    engineCalls.length = 0;
    const res = fakeRes();
    await load('../controllers/publicQuoteController').quote({ body, query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.equal(engineCalls.length, 0);
  });

  test(`POST /booking-requests refuses ${label} with 422 VALIDATION_FAILED, the engine untouched`, () => {
    engineCalls.length = 0;
    const res = fakeRes();
    load('../controllers/publicBookingRequestController').create({ body: { ...body, guest }, query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.equal(engineCalls.length, 0);
  });
}
