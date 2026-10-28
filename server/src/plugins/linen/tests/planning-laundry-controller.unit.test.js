const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController: buildPlanningController } = require('../planningController');
const { fakeScheduleModel } = require('./laundry-schedule-fixtures');

// The controller no longer falls back to models bound to the app database (it is wired by the
// plugin), so the tests that do not care about manual lines pass an empty one.
const NO_MANUAL_LINES = {
  listAll: () => ({}),
  sumForWindow: () => ({ singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 }),
};
const buildController = (deps) => buildPlanningController({
  laundryManualAdditionsModel: NO_MANUAL_LINES,
  today: () => '2026-06-01',
  laundryScheduleModel: fakeScheduleModel(deps.settingsModel.read().laundryWeekday),
  ...deps,
});

// Controller-level tests with fake models. Pin the shape of the payload + the validation rules
// (specs/weekly-bed-linen-tracking.md §4.3, specs/linen-laundry-days.md §4.3).

// Every window holds one single sheet: enough for the server to draw a card on each laundry day.
const SOME_LINEN = () => ({ singleBeds: 1, doubleBeds: 0, babyBeds: 0 });

function makeFake({
  laundryWeekday = 2,
  windowFn = () => ({ singleBeds: 0, doubleBeds: 0, babyBeds: 0 }),
  bathroomFn = () => ({ largeTowels: 0, mediumTowels: 0, smallTowels: 0 }),
  bathMatFn = () => ({ bathMats: 0 }),
  incompleteFn = null,
  skippedDates = [],
  extraTrips = [],
  inventoryHorizon = null,
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
    dropOffBathMatForWindow(start, end) {
      calls.push({ fn: 'bathMat', start, end });
      return bathMatFn(start, end);
    },
  };
  // specs/laundry-counts-explicit-option-only.md §3.2 — omitted by default so the legacy tests
  // exercise the controller's "older model without the method" guard.
  if (incompleteFn) {
    laundryModel.incompleteBedConfigForWindow = (start, end) => {
      calls.push({ fn: 'incomplete', start, end });
      return incompleteFn(start, end);
    };
  }
  // Default to no skips so the legacy tests stay byte-identical in payload shape.
  const laundryTripSkipsModel = { listAll: () => [...skippedDates] };
  // specs/laundry-extra-trip.md — extra trips on a free date. Empty by default; stubbed so the
  // controller never falls back to the model bound to the real dev DB.
  const laundryExtraTripsModel = { listAll: () => [...extraTrips] };
  // Used by the implicit-`to`-from-horizon path. Tests that pass an explicit `to` query
  // param never hit this — they assert the legacy contract.
  const linenInventoryModel = {
    simulate: () => (inventoryHorizon ? { horizon: inventoryHorizon, days: [] } : null),
  };
  return { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls };
}

// The cards of the Planning for a window, listed as `laundryDays` (date + card) the way the former summary
// endpoint listed them: only the dates the server decides to draw (specs/linen-laundry-days.md rule 13).
function callDays(c, query, res) {
  c.laundryDays({ query }, res);
  if (res.statusCode === 200) res.body = { laundryDays: Object.entries(res.body.days).map(([date, card]) => ({ date, ...card })) };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('laundryDays: 14-day range draws exactly the laundry days that carry linen', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 2, windowFn: SOME_LINEN });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-01', to: '2026-06-14' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.laundryDays.map((d) => d.date), ['2026-06-02', '2026-06-09']);
});

test('laundryDays: per laundry day, dropOff queries (L-7, L] and pickUp queries (L-14, L-7]', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  callDays(c, { from: '2026-06-01', to: '2026-06-08' }, fakeRes());
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

test('laundryDays: manual additions fold into this trip dropOff + the next trip pickUp', () => {
  // specs/manual-laundry-additions.md §3 rules 2-3. Manual addition of 3 single beds on 2026-06-09.
  const fake = makeFake({ laundryWeekday: 2 });
  const laundryManualAdditionsModel = {
    listAll: () => ({}),
    sumForWindow: (start, end) => ({
      singleBeds: (start < '2026-06-09' && '2026-06-09' <= end) ? 3 : 0,
      doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0,
    }),
  };
  const c = buildController({ ...fake, laundryManualAdditionsModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-16' }, res);
  const day = (d) => res.body.laundryDays.find((x) => x.date === d);
  assert.equal(day('2026-06-09').dropOff.singleBeds, 3, 'this trip À apporter +3');
  assert.equal(day('2026-06-16').pickUp.singleBeds, 3, 'next trip À récupérer +3 (the batch returns)');
  assert.equal(day('2026-06-16').dropOff.singleBeds, 0, 'next trip dropOff window excludes 06-09');
});

test('laundryDays: weekday change in settings is honoured (Wednesday)', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 3, windowFn: SOME_LINEN });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-01', to: '2026-06-14' }, res);
  // Wednesdays in window: 06-03 + 06-10.
  assert.deepEqual(res.body.laundryDays.map((d) => d.date), ['2026-06-03', '2026-06-10']);
});

test('laundryDays: payload carries dropOff + pickUp per laundry day (bed + bathroom merged)', () => {
  // Different windowFn per call: dropOff(2026-06-02) = {1,2,3}, pickUp(2026-06-02) = drop(2026-05-26) = {4,5,6}.
  const windowFn = (start, end) => {
    if (start === '2026-05-26' && end === '2026-06-02') return { singleBeds: 1, doubleBeds: 2, babyBeds: 3 };
    if (start === '2026-05-19' && end === '2026-05-26') return { singleBeds: 4, doubleBeds: 5, babyBeds: 6 };
    return { singleBeds: 0, doubleBeds: 0, babyBeds: 0 };
  };
  // Same windows for the bathroom call: 7 people on drop, 9 people on pickUp.
  const bathroomFn = (start, end) => {
    if (start === '2026-05-26' && end === '2026-06-02') return { largeTowels: 7, mediumTowels: 0, smallTowels: 7 };
    if (start === '2026-05-19' && end === '2026-05-26') return { largeTowels: 9, mediumTowels: 0, smallTowels: 9 };
    return { largeTowels: 0, mediumTowels: 0, smallTowels: 0 };
  };
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 2, windowFn, bathroomFn });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);
  // Server merges bed + bathroom into one block per side; the client renders both as
  // sub-lines under the same "À apporter / À récupérer" header.
  assert.deepEqual(res.body.laundryDays, [{
    date: '2026-06-02',
    kind: 'regular',
    dropOff: { singleBeds: 1, doubleBeds: 2, babyBeds: 3, largeTowels: 7, mediumTowels: 0, smallTowels: 7, bathMats: 0, incomplete: [] },
    pickUp: { singleBeds: 4, doubleBeds: 5, babyBeds: 6, largeTowels: 9, mediumTowels: 0, smallTowels: 9, bathMats: 0, fromTrips: ['2026-05-26'] },
    stillAtLaundry: null,
    isSkipped: false,
    inventoryAfter: null,
    manualAddition: null,
    extraTrip: null,
    leftAtLaundry: null,
  }]);
});

test('laundryDays: 400 on missing from', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { to: '2026-06-14' }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_DATE_RANGE');
});

test('laundryDays: 400 on malformed date', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '06/01/2026', to: '2026-06-14' }, res);
  assert.equal(res.statusCode, 400);
});

test('laundryDays: 400 when from > to', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake();
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-14', to: '2026-06-01' }, res);
  assert.equal(res.statusCode, 400);
});

test('laundryDays: empty range (no laundry day in window) returns laundryDays=[]', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  // Wed → Mon, no Tuesday inside.
  callDays(c, { from: '2026-06-03', to: '2026-06-08' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.laundryDays, []);
});

test('laundryDays: a laundry day with nothing on either side is not drawn (the server decides, rule 13)', () => {
  // windowFn returns zeros for every query → no card. The silence is the server's decision now; the card
  // used to hide itself on the client (the former weekly-bed-linen rule 13).
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 2 });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.laundryDays, []);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// specs/skip-laundry-trip.md §3.1 rule 6 + §3.3 rule 9 — the controller must see the skip
// set so the À apporter / À récupérer counts on the next non-skipped card absorb the
// deferred batch. Before these tests pinned the contract, the inventory line was already
// skip-aware (via linenInventoryModel.simulate) but the drop-off / pick-up windows still
// used a flat `L - 7` step, which is exactly the user-visible bug
// ("la carte blanchisserie suivante ne change pas").
// ─────────────────────────────────────────────────────────────────────────────────────────

test('laundryDays: skipped laundry day returns zero blocks (client renders "Voyage non réalisé")', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    // If any window is queried for this day, return non-zero. The skip path must NOT call.
    windowFn: () => ({ singleBeds: 9, doubleBeds: 9, babyBeds: 9 }),
    bathroomFn: () => ({ largeTowels: 9, mediumTowels: 9, smallTowels: 9 }),
    skippedDates: ['2026-06-02'],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.laundryDays.length, 1);
  assert.equal(res.body.laundryDays[0].date, '2026-06-02');
  assert.deepEqual(res.body.laundryDays[0].dropOff, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0,
    incomplete: [],
  });
  assert.deepEqual(res.body.laundryDays[0].pickUp, {
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0, fromTrips: [],
  });
  // No window query was issued for the skipped day — proves we shortcut before hitting the model.
  assert.equal(calls.length, 0);
});

test('laundryDays: non-skipped trip after a skip widens the drop-off window backward through the skip', () => {
  // Setup: laundryWeekday = 2 (Tuesday). L = 2026-06-09 (Tue), the trip 7 days earlier
  // (2026-06-02) is skipped. Expected window for 2026-06-09 drop-off: (2026-05-26, 2026-06-09]
  // — i.e. 14 days, absorbing the missed batch. PickUp(2026-06-09) reflects what was deposited
  // on the previous NON-skipped trip = 2026-05-26 → window (2026-05-19, 2026-05-26].
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    skippedDates: ['2026-06-02'],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-09', to: '2026-06-09' }, res);
  const bedCalls = calls.filter((cc) => cc.fn === 'bed').map(({ fn, ...rest }) => rest);
  assert.deepEqual(bedCalls[0], { start: '2026-05-26', end: '2026-06-09' });
  assert.deepEqual(bedCalls[1], { start: '2026-05-19', end: '2026-05-26' });
});

test('laundryDays: two consecutive skips before a non-skipped trip widen the window to 21 days', () => {
  // L = 2026-06-16 (Tue). Skipped: 2026-06-02 + 2026-06-09. Previous non-skipped = 2026-05-26.
  // Expected drop-off window: (2026-05-26, 2026-06-16] — 21 days.
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    skippedDates: ['2026-06-02', '2026-06-09'],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-16', to: '2026-06-16' }, res);
  const bedCalls = calls.filter((cc) => cc.fn === 'bed').map(({ fn, ...rest }) => rest);
  assert.deepEqual(bedCalls[0], { start: '2026-05-26', end: '2026-06-16' });
  // PickUp reflects what was deposited at the previous non-skipped trip (2026-05-26),
  // whose batch is the (2026-05-19, 2026-05-26] window.
  assert.deepEqual(bedCalls[1], { start: '2026-05-19', end: '2026-05-26' });
});

test('laundryDays: a skip bleeds into the next trip only, then propagation stops', () => {
  // L = 2026-06-02 absorbs the 2026-05-26 skipped batch. L = 2026-06-09 — both 2026-06-02
  // AND 2026-05-26's deferral are now behind it, so its window is the plain (L-7, L].
  // Pin the bleed AND the stop in one test, to catch a regression where the skip semantics
  // either over-shoot (apply forever) or under-shoot (don't widen at all).
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    skippedDates: ['2026-05-26'],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-09' }, res);
  const bedCalls = calls.filter((cc) => cc.fn === 'bed').map(({ fn, ...rest }) => rest);
  // 2026-06-02 dropOff widens to (2026-05-19, 2026-06-02] — 14 days, captures the deferred batch.
  assert.deepEqual(bedCalls[0], { start: '2026-05-19', end: '2026-06-02' });
  // 2026-06-02 pickUp — previous non-skipped from 2026-05-19 is 2026-05-12 → (2026-05-12, 2026-05-19].
  assert.deepEqual(bedCalls[1], { start: '2026-05-12', end: '2026-05-19' });
  // 2026-06-09 dropOff — both previous trips are non-skipped → plain (2026-06-02, 2026-06-09].
  assert.deepEqual(bedCalls[2], { start: '2026-06-02', end: '2026-06-09' });
  // 2026-06-09 pickUp — what was deposited at 2026-06-02 = the 14-day batch (2026-05-19, 2026-06-02].
  assert.deepEqual(bedCalls[3], { start: '2026-05-19', end: '2026-06-02' });
});

test('laundryDays: when the entire 4-week lookback is skipped, falls back to L-7 (degenerate but always returns a window)', () => {
  // Skipping 4+ consecutive Tuesdays makes `previousNonSkippedLaundryDay` return null. The
  // controller must still emit something for the L itself — fall back to the plain L-7 window.
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    skippedDates: ['2026-06-09', '2026-06-02', '2026-05-26', '2026-05-19', '2026-05-12'],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-16', to: '2026-06-16' }, res);
  const bedCalls = calls.filter((cc) => cc.fn === 'bed').map(({ fn, ...rest }) => rest);
  // Fallback: (2026-06-09, 2026-06-16] — exactly what the pre-feature code would have used.
  assert.deepEqual(bedCalls[0], { start: '2026-06-09', end: '2026-06-16' });
});

// specs/linen-laundry-days.md rule 13 — both bounds are required: the horizon default of the former summary
// endpoint is gone (the host always asks for the window it shows, past or future).

test('laundryDays: `to` omitted → 400 INVALID_DATE_RANGE, no horizon fallback', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({
    laundryWeekday: 2,
    inventoryHorizon: '2026-07-14',
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-09' }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_DATE_RANGE');
});

test('laundryDays: `from` malformed → still 400 even when `to` is omitted', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({
    laundryWeekday: 2, inventoryHorizon: '2026-07-14',
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '06/01/2026' }, res);
  assert.equal(res.statusCode, 400);
});

// --- specs/laundry-counts-explicit-option-only.md §3.2 — incompleteness list on the drop-off ---

// specs/laundry-counts-explicit-option-only.md rule 8 — drop-off side only, `{ id, clientName, propertyName, endDate }`.
test('laundryDays: the drop-off carries the stays that declare linen with no quantity yet', () => {
  const stay = { id: 22212, clientName: 'Jean Dupont', propertyName: 'Aventura lodge', endDate: '2026-06-01' };
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    incompleteFn: (start, end) => ((start === '2026-05-26' && end === '2026-06-02') ? [stay] : []),
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);

  assert.deepEqual(res.body.laundryDays[0].dropOff.incomplete, [stay]);
  // Pick-up is a past batch — nothing left to fill in, so it carries no list at all.
  assert.equal(res.body.laundryDays[0].pickUp.incomplete, undefined);
  // Queried on the DROP-OFF window only, exactly once.
  const incompleteCalls = calls.filter((cc) => cc.fn === 'incomplete').map(({ fn, ...rest }) => rest);
  assert.deepEqual(incompleteCalls, [{ start: '2026-05-26', end: '2026-06-02' }]);
});

// specs/laundry-counts-explicit-option-only.md rule 10 — the warning is informational: the counts stay
// exactly what the window says.
test('laundryDays: a flagged stay leaves the drop-off counts untouched', () => {
  const stay = { id: 22212, clientName: 'Jean Dupont', propertyName: 'Aventura lodge', endDate: '2026-06-01' };
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({
    laundryWeekday: 2,
    windowFn: (start, end) => ((start === '2026-05-26' && end === '2026-06-02')
      ? { singleBeds: 2, doubleBeds: 3, babyBeds: 1 }
      : { singleBeds: 0, doubleBeds: 0, babyBeds: 0 }),
    incompleteFn: () => [stay],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);

  const { dropOff } = res.body.laundryDays[0];
  assert.deepEqual(dropOff.incomplete, [stay]);
  assert.deepEqual([dropOff.singleBeds, dropOff.doubleBeds, dropOff.babyBeds], [2, 3, 1]);
});

test('laundryDays: a skipped trip emits an empty incompleteness list and queries nothing', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel, calls } = makeFake({
    laundryWeekday: 2,
    skippedDates: ['2026-06-02'],
    incompleteFn: () => [{ id: 1, clientName: 'X', propertyName: 'Y', endDate: '2026-06-01' }],
  });
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);

  assert.deepEqual(res.body.laundryDays[0].dropOff.incomplete, []);
  assert.equal(calls.length, 0);
});

test('laundryDays: a model without incompleteBedConfigForWindow degrades to an empty list', () => {
  const { settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel } = makeFake({ laundryWeekday: 2, windowFn: SOME_LINEN });
  assert.equal(typeof laundryModel.incompleteBedConfigForWindow, 'undefined');
  const c = buildController({ settingsModel, laundryModel, laundryTripSkipsModel, laundryExtraTripsModel, linenInventoryModel });
  const res = fakeRes();
  callDays(c, { from: '2026-06-02', to: '2026-06-02' }, res);
  assert.deepEqual(res.body.laundryDays[0].dropOff.incomplete, []);
});

test('laundryDays: a manual withdrawal leaves the trip, and a block never goes negative', () => {
  // specs/laundry-manual-removals.md §3 rule 3 — « je lave moi-même » 2 draps simples on 2026-06-09.
  // The reservations of that window bring 3 → the trip carries 1. A withdrawal bigger than the trip
  // floors the block at 0: one cannot deposit a negative pile.
  const fake = makeFake({
    laundryWeekday: 2,
    windowFn: (start, end) => (
      (start < '2026-06-09' && '2026-06-09' <= end)
        ? { singleBeds: 3, doubleBeds: 0, babyBeds: 0 }
        : { singleBeds: 0, doubleBeds: 0, babyBeds: 0 }
    ),
  });
  const withdrawal = (n) => ({
    listAll: () => ({}),
    sumForWindow: (start, end) => ({
      singleBeds: (start < '2026-06-09' && '2026-06-09' <= end) ? n : 0,
      doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0,
    }),
  });

  const res = fakeRes();
  callDays(buildController({ ...fake, laundryManualAdditionsModel: withdrawal(-2) }), { from: '2026-06-02', to: '2026-06-16' }, res);
  const day = (body, d) => body.laundryDays.find((x) => x.date === d);
  assert.equal(day(res.body, '2026-06-09').dropOff.singleBeds, 1, '3 − 2 washed at home');
  assert.equal(day(res.body, '2026-06-16').pickUp.singleBeds, 1, 'only what really left comes back');

  const res2 = fakeRes();
  callDays(buildController({ ...fake, laundryManualAdditionsModel: withdrawal(-9) }), { from: '2026-06-02', to: '2026-06-16' }, res2);
  // Floored at 0 — never negative — so there is nothing to carry and nothing to draw (rule 13).
  assert.equal(day(res2.body, '2026-06-09'), undefined);
  assert.equal(day(res2.body, '2026-06-16'), undefined);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// specs/laundry-extra-trip.md §3.2 rule 10 — extra trips are listed among the regular days.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('laundryDays: every card carries kind, and an extra trip in range is drawn with its record + leftAtLaundry', () => {
  // Tuesday 06-02 drops 5 singles; the Thursday 06-04 extra trip drops 2 and takes 1 of the 5 back;
  // Tuesday 06-09 drops 3 and takes back the 4 left + the 2 dropped on Thursday.
  const windowFn = (start, end) => {
    if (start === '2026-05-26' && end === '2026-06-02') return { singleBeds: 5, doubleBeds: 0, babyBeds: 0 };
    if (start === '2026-06-02' && end === '2026-06-04') return { singleBeds: 2, doubleBeds: 0, babyBeds: 0 };
    if (start === '2026-06-04' && end === '2026-06-09') return { singleBeds: 3, doubleBeds: 0, babyBeds: 0 };
    return { singleBeds: 0, doubleBeds: 0, babyBeds: 0 };
  };
  const fake = makeFake({
    laundryWeekday: 2, windowFn,
    extraTrips: [{ date: '2026-06-04', pickUpAll: false, pickUp: { singleBeds: 1, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0 } }],
  });
  const c = buildController({ ...fake });
  const res = fakeRes();
  callDays(c, { from: '2026-06-01', to: '2026-06-09' }, res);
  assert.deepEqual(res.body.laundryDays.map((d) => [d.date, d.kind]), [
    ['2026-06-02', 'regular'], ['2026-06-04', 'extra'], ['2026-06-09', 'regular'],
  ]);
  const [tue1, thu, tue2] = res.body.laundryDays;
  assert.equal(tue1.extraTrip, null);
  assert.equal(thu.extraTrip.pickUpAll, false);
  assert.equal(thu.dropOff.singleBeds, 2);
  assert.deepEqual(thu.dropOff.incomplete, []);
  assert.equal(thu.pickUp.singleBeds, 1);
  assert.equal(thu.leftAtLaundry.singleBeds, 4);
  assert.equal(tue2.dropOff.singleBeds, 3);
  assert.equal(tue2.pickUp.singleBeds, 4 + 2);
});

test('laundryDays: an extra trip outside the requested range is not listed but still shapes the windows', () => {
  const fake = makeFake({
    laundryWeekday: 2, windowFn: SOME_LINEN,
    extraTrips: [{ date: '2026-06-04', pickUpAll: true, pickUp: {} }],
  });
  const c = buildController({ ...fake });
  const res = fakeRes();
  callDays(c, { from: '2026-06-09', to: '2026-06-09' }, res);
  assert.deepEqual(res.body.laundryDays.map((d) => d.date), ['2026-06-09']);
  // Drop-off window of 06-09 starts at the Thursday, not at 06-02.
  const bedCalls = fake.calls.filter((cc) => cc.fn === 'bed').map(({ fn, ...rest }) => rest);
  assert.deepEqual(bedCalls[0], { start: '2026-06-04', end: '2026-06-09' });
});

test('laundryDays: an extra trip stored on the laundry weekday is inert (listed as the regular day it is)', () => {
  const fake = makeFake({
    laundryWeekday: 2, windowFn: SOME_LINEN,
    extraTrips: [{ date: '2026-06-09', pickUpAll: false, pickUp: { singleBeds: 1 } }],
  });
  const c = buildController({ ...fake });
  const res = fakeRes();
  callDays(c, { from: '2026-06-09', to: '2026-06-09' }, res);
  assert.deepEqual(res.body.laundryDays.map((d) => [d.date, d.kind]), [['2026-06-09', 'regular']]);
  assert.equal(res.body.laundryDays[0].extraTrip, null);
});
