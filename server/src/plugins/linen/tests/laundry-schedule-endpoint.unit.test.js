const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { MIGRATIONS } = require('../migrations');
const laundryScheduleModel = require('../laundryScheduleModel');
const laundryScheduleController = require('../laundryScheduleController');
const { addDays } = require('../laundryWindow');

// specs/linen-laundry-days.md §4.3 — the three schedule handlers, driven with mock req/res on a real
// table. Role enforcement is `enforceRoleAccess`'s (see reception-role-access.unit.test.js).

const MIGRATION = MIGRATIONS.find((m) => m.name === 'laundry_schedule_v1');

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// 2026-06-09 is a Tuesday: today = Tuesday, tomorrow = Wednesday 2026-06-10.
function fresh({ today = '2026-06-09', weekday = '2' } = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE plugin_settings (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (plugin_id, key))');
  db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('linen', 'laundryWeekday', ?)").run(weekday);
  MIGRATION.up(db);
  const model = laundryScheduleModel.create(db);
  const clock = { today };
  const ctrl = laundryScheduleController.create({ scheduleModel: model, today: () => clock.today });
  const call = (method, body) => { const res = makeRes(); ctrl[method]({ body }, res); return res; };
  return { model, clock, call };
}

const stripCycle = ({ cycle, longestWaitDays, ...rest }) => rest;

test('specs/linen-laundry-days.md §4.3: GET returns the version in force, no pending version, and tomorrow', () => {
  const { call } = fresh();
  const res = call('get');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(stripCycle(res.body.current), { effectiveFrom: '0001-01-01', weekdays: [2], turnaroundDays: 1 });
  assert.deepEqual(res.body.current.cycle, [{ dropWeekday: 2, pickUpWeekday: 2, waitDays: 7 }]);
  assert.equal(res.body.current.longestWaitDays, 7);
  assert.equal(res.body.pending, null);
  assert.equal(res.body.tomorrow, '2026-06-10');
});

test('specs/linen-laundry-days.md §3.1 rule 5: PUT writes the version effective tomorrow, and today keeps its rhythm', () => {
  const { call, model } = fresh();
  const res = call('set', { weekdays: [4, 2], turnaroundDays: 2 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(stripCycle(res.body.current), { effectiveFrom: '0001-01-01', weekdays: [2], turnaroundDays: 1 });
  assert.deepEqual(stripCycle(res.body.pending), { effectiveFrom: '2026-06-10', weekdays: [2, 4], turnaroundDays: 2 });
  assert.deepEqual(res.body.pending.cycle, [
    { dropWeekday: 2, pickUpWeekday: 4, waitDays: 2 }, { dropWeekday: 4, pickUpWeekday: 2, waitDays: 5 },
  ]);
  assert.equal(model.listAll().length, 2);
});

test('specs/linen-laundry-days.md §3.1 rule 5: saving again before tomorrow overwrites the pending version', () => {
  const { call, model } = fresh();
  call('set', { weekdays: [2, 4], turnaroundDays: 2 });
  const res = call('set', { weekdays: [1, 3, 5], turnaroundDays: 4 });
  assert.equal(model.listAll().length, 2);
  assert.deepEqual(stripCycle(res.body.pending), { effectiveFrom: '2026-06-10', weekdays: [1, 3, 5], turnaroundDays: 4 });
});

test('specs/linen-laundry-days.md §3.3 rule 22: saving what is already in force deletes the pending version', () => {
  const { call, model } = fresh();
  call('set', { weekdays: [2, 4], turnaroundDays: 2 });
  const res = call('set', { weekdays: [2], turnaroundDays: 1 });
  assert.equal(res.body.pending, null);
  assert.deepEqual(model.listAll().map((v) => v.effectiveFrom), ['0001-01-01']);
  // And saving the version in force when nothing is pending is a harmless no-op.
  assert.equal(call('set', { weekdays: [2], turnaroundDays: 1 }).statusCode, 200);
  assert.equal(model.listAll().length, 1);
});

test('specs/linen-laundry-days.md §3.1 rule 5: the next day the pending version has become the one in force, and a new save is dated a day later', () => {
  const { call, clock, model } = fresh();
  call('set', { weekdays: [2, 4], turnaroundDays: 2 });
  clock.today = '2026-06-10';
  const view = call('get');
  assert.deepEqual(stripCycle(view.body.current), { effectiveFrom: '2026-06-10', weekdays: [2, 4], turnaroundDays: 2 });
  assert.equal(view.body.pending, null);
  assert.equal(view.body.tomorrow, '2026-06-11');
  const res = call('set', { weekdays: [2], turnaroundDays: 1 });
  assert.deepEqual(stripCycle(res.body.pending), { effectiveFrom: '2026-06-11', weekdays: [2], turnaroundDays: 1 });
  assert.deepEqual(model.listAll().map((v) => v.effectiveFrom), ['0001-01-01', '2026-06-10', '2026-06-11']);
});

test('specs/linen-laundry-days.md §3.1 rule 5: tomorrow crosses a month and a year end', () => {
  const { call } = fresh({ today: '2026-12-31' });
  assert.equal(call('get').body.tomorrow, '2027-01-01');
  assert.equal(call('set', { weekdays: [3], turnaroundDays: 1 }).body.pending.effectiveFrom, '2027-01-01');
});

test('specs/linen-laundry-days.md §3.1 rule 3: every refusal is a 400 with the message, the code and the field — and writes nothing', () => {
  const { call, model } = fresh();
  const cases = [
    [{ weekdays: [], turnaroundDays: 1 }, 'LAUNDRY_WEEKDAYS_EMPTY', 'Au moins un jour.', 'weekdays'],
    [{ weekdays: [7], turnaroundDays: 1 }, 'LAUNDRY_WEEKDAY_INVALID', 'Jour invalide.', 'weekdays'],
    [{ weekdays: [2, 2], turnaroundDays: 1 }, 'LAUNDRY_WEEKDAY_INVALID', 'Jour invalide.', 'weekdays'],
    [{ weekdays: [2], turnaroundDays: 0 }, 'LAUNDRY_TURNAROUND_INVALID', 'Entre 1 et 14 jours.', 'turnaroundDays'],
    [{ weekdays: [2], turnaroundDays: 15 }, 'LAUNDRY_TURNAROUND_INVALID', 'Entre 1 et 14 jours.', 'turnaroundDays'],
    [{ weekdays: [2], turnaroundDays: 2.5 }, 'LAUNDRY_TURNAROUND_INVALID', 'Entre 1 et 14 jours.', 'turnaroundDays'],
    [{ weekdays: [2], turnaroundDays: 'abc' }, 'LAUNDRY_TURNAROUND_INVALID', 'Entre 1 et 14 jours.', 'turnaroundDays'],
    [undefined, 'LAUNDRY_WEEKDAYS_EMPTY', 'Au moins un jour.', 'weekdays'],
  ];
  for (const [body, code, error, field] of cases) {
    for (const method of ['set', 'preview']) {
      const res = call(method, body);
      assert.equal(res.statusCode, 400, `${method} ${JSON.stringify(body)}`);
      assert.deepEqual(res.body, { error, code, field });
    }
  }
  assert.equal(model.listAll().length, 1);
});

test('specs/linen-laundry-days.md §3.1 rule 7: the preview describes the cycle and the first laundry day it applies to, with no side effect', () => {
  const { call, model } = fresh();
  const res = call('preview', { weekdays: [2, 4], turnaroundDays: 3 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    cycle: [{ dropWeekday: 2, pickUpWeekday: 2, waitDays: 7 }, { dropWeekday: 4, pickUpWeekday: 2, waitDays: 5 }],
    longestWaitDays: 7,
    firstTripOn: '2026-06-11',
  });
  assert.equal(model.listAll().length, 1);
});

test('specs/linen-laundry-days.md §3.1 rule 7: firstTripOn is the first laundry day from tomorrow on', () => {
  const { call } = fresh();
  assert.equal(call('preview', { weekdays: [3], turnaroundDays: 1 }).body.firstTripOn, '2026-06-10');   // tomorrow itself
  assert.equal(call('preview', { weekdays: [2], turnaroundDays: 1 }).body.firstTripOn, '2026-06-16');   // today is not "from tomorrow"
  assert.equal(call('preview', { weekdays: [0, 1, 2, 3, 4, 5, 6], turnaroundDays: 14 }).body.firstTripOn, addDays('2026-06-09', 1));
});
