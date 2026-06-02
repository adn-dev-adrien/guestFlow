const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/planningController');

// Controller-level tests with fake models. Pin the shape of the payload + the validation rules
// (specs/weekly-bed-linen-tracking.md §4.3).

function makeFake({
  laundryWeekday = 2,
  windowFn = () => ({ singleBeds: 0, doubleBeds: 0, babyBeds: 0 }),
  bathroomFn = () => ({ largeTowels: 0, smallTowels: 0 }),
} = {}) {
  const settingsModel = { read: () => ({ laundryWeekday }) };
  const calls = [];
  const laundryModel = {
    dropOffForWindow(start, end) {
      calls.push({ fn: 'bed', start, end });
      return windowFn(start, end);
    },
    dropOffBathroomForWindow(start, end) {
      calls.push({ fn: 'bathroom', start, end });
      return bathroomFn(start, end);
    },
  };
  return { settingsModel, laundryModel, calls };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('laundrySummary: 14-day range emits exactly the right number of laundry days', () => {
  const { settingsModel, laundryModel } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '2026-06-01', to: '2026-06-14' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.laundryWeekday, 2);
  assert.deepEqual(res.body.laundryDays.map((d) => d.date), ['2026-06-02', '2026-06-09']);
});

test('laundrySummary: per laundry day, dropOff queries (L-7, L] and pickUp queries (L-14, L-7]', () => {
  const { settingsModel, laundryModel, calls } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel });
  c.laundrySummary({ query: { from: '2026-06-01', to: '2026-06-08' } }, fakeRes());
  // For L = 2026-06-02: dropOff (2026-05-26, 2026-06-02], pickUp (2026-05-19, 2026-05-26].
  // After §3.5 the controller calls bed THEN bathroom for each block — filter by `fn` so
  // this test stays focused on the window math, not the sub-query interleaving.
  const bedCalls = calls.filter((c) => c.fn === 'bed').map(({ fn, ...rest }) => rest);
  assert.deepEqual(bedCalls[0], { start: '2026-05-26', end: '2026-06-02' });
  assert.deepEqual(bedCalls[1], { start: '2026-05-19', end: '2026-05-26' });
  // The bathroom calls follow the exact same windows.
  const bathCalls = calls.filter((c) => c.fn === 'bathroom').map(({ fn, ...rest }) => rest);
  assert.deepEqual(bathCalls[0], { start: '2026-05-26', end: '2026-06-02' });
  assert.deepEqual(bathCalls[1], { start: '2026-05-19', end: '2026-05-26' });
});

test('laundrySummary: weekday change in settings is honoured (Wednesday)', () => {
  const { settingsModel, laundryModel } = makeFake({ laundryWeekday: 3 });
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '2026-06-01', to: '2026-06-14' } }, res);
  assert.equal(res.body.laundryWeekday, 3);
  // Wednesdays in window: 06-03 + 06-10.
  assert.deepEqual(res.body.laundryDays.map((d) => d.date), ['2026-06-03', '2026-06-10']);
});

test('laundrySummary: payload carries dropOff + pickUp per laundry day (bed + bathroom merged)', () => {
  // Different windowFn per call: dropOff(2026-06-02) = {1,2,3}, pickUp(2026-06-02) = drop(2026-05-26) = {4,5,6}.
  const windowFn = (start, end) => {
    if (start === '2026-05-26' && end === '2026-06-02') return { singleBeds: 1, doubleBeds: 2, babyBeds: 3 };
    if (start === '2026-05-19' && end === '2026-05-26') return { singleBeds: 4, doubleBeds: 5, babyBeds: 6 };
    return { singleBeds: 0, doubleBeds: 0, babyBeds: 0 };
  };
  // Same windows for the bathroom call: 7 people on drop, 9 people on pickUp.
  const bathroomFn = (start, end) => {
    if (start === '2026-05-26' && end === '2026-06-02') return { largeTowels: 7, smallTowels: 7 };
    if (start === '2026-05-19' && end === '2026-05-26') return { largeTowels: 9, smallTowels: 9 };
    return { largeTowels: 0, smallTowels: 0 };
  };
  const { settingsModel, laundryModel } = makeFake({ laundryWeekday: 2, windowFn, bathroomFn });
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '2026-06-02', to: '2026-06-02' } }, res);
  // Server merges bed + bathroom into one block per side; the client renders both as
  // sub-lines under the same "À apporter / À récupérer" header.
  assert.deepEqual(res.body.laundryDays, [{
    date: '2026-06-02',
    dropOff: { singleBeds: 1, doubleBeds: 2, babyBeds: 3, largeTowels: 7, smallTowels: 7 },
    pickUp: { singleBeds: 4, doubleBeds: 5, babyBeds: 6, largeTowels: 9, smallTowels: 9 },
  }]);
});

test('laundrySummary: 400 on missing from', () => {
  const { settingsModel, laundryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { to: '2026-06-14' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_DATE_RANGE');
});

test('laundrySummary: 400 on malformed date', () => {
  const { settingsModel, laundryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '06/01/2026', to: '2026-06-14' } }, res);
  assert.equal(res.statusCode, 400);
});

test('laundrySummary: 400 when from > to', () => {
  const { settingsModel, laundryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '2026-06-14', to: '2026-06-01' } }, res);
  assert.equal(res.statusCode, 400);
});

test('laundrySummary: empty range (no laundry day in window) returns laundryDays=[]', () => {
  const { settingsModel, laundryModel } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  // Wed → Mon, no Tuesday inside.
  c.laundrySummary({ query: { from: '2026-06-03', to: '2026-06-08' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.laundryDays, []);
});

test('laundrySummary: zero-everywhere laundry day is STILL emitted (server contract is uniform; client filters)', () => {
  // windowFn returns zeros for every query → the controller doesn't drop the day. The client
  // is responsible for hiding the silent card (rule 13).
  const { settingsModel, laundryModel } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel });
  const res = fakeRes();
  c.laundrySummary({ query: { from: '2026-06-02', to: '2026-06-02' } }, res);
  assert.equal(res.body.laundryDays.length, 1);
  // Bed AND bathroom blocks merged into one zero block per side (5 keys total).
  assert.deepEqual(
    res.body.laundryDays[0].dropOff,
    { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, smallTowels: 0 }
  );
  assert.deepEqual(
    res.body.laundryDays[0].pickUp,
    { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, smallTowels: 0 }
  );
});
