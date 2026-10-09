/**
 * Reception projection on resource planning events + bounded date ranges.
 * 2026-10-08 infrastructure audit — AUTH-4 (finance/PII leak to reception) and DATA-1 (unbounded
 * range CPU/SQL DoS reachable by reception).
 *
 * Covers specs/reception-role-checkin-only.md rule 12ter (reception planning-event projection +
 * bounded date range).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkPlanningRange, isIsoDate, daysBetween, MAX_PLANNING_RANGE_DAYS } = require('../utils/planningDateRange');
const { toReceptionPlanningEvent, PLANNING_EVENT_KEEP } = require('../utils/receptionView');
const { buildController: buildResourceBookings } = require('../controllers/resourceBookingsController');
const { buildController: buildPlanning } = require('../controllers/planningController');

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}

// A planning event as the model returns it, carrying everything the audit flagged as leaking.
function fullEvent() {
  return {
    id: 7, kind: 'booking', reservationId: 42, resourceId: 3, resourceName: 'Spa',
    propertyId: 1, propertyName: 'Gîte A', date: '2026-07-01', startTime: '10:00', endTime: '11:00',
    turnoverMinutes: 15, displayName: 'Jean Dupont',
    // sensitive — must NOT reach reception:
    clientPhone: '+33600000000', notes: 'allergique', totalPrice: 120, resourcePrice: 120,
    paid: true, firstName: 'Jean', lastName: 'Dupont', clientName: 'Jean Dupont', slotDuration: 60,
  };
}

// ---------- AUTH-4: projection ----------

test('toReceptionPlanningEvent keeps only the whitelist, drops finance + PII', () => {
  const view = toReceptionPlanningEvent(fullEvent());
  assert.deepEqual(Object.keys(view).sort(), [...PLANNING_EVENT_KEEP].sort());
  for (const leak of ['clientPhone', 'notes', 'totalPrice', 'resourcePrice', 'paid', 'firstName', 'lastName', 'clientName', 'slotDuration']) {
    assert.equal(leak in view, false, `${leak} must not reach reception`);
  }
  assert.equal(view.displayName, 'Jean Dupont'); // operator label survives
  assert.equal(view.resourceName, 'Spa');
});

test('planning-events: reception gets the projection, admin gets the full payload', () => {
  const model = { listPlanningEvents: () => [fullEvent()] };
  const c = buildResourceBookings(model);

  const rRec = res();
  c.planningEvents({ query: { from: '2026-07-01', to: '2026-07-31' }, user: { roles: ['reception'] } }, rRec);
  assert.equal('paid' in rRec.body[0], false);
  assert.equal('clientPhone' in rRec.body[0], false);

  const rAdmin = res();
  c.planningEvents({ query: { from: '2026-07-01', to: '2026-07-31' }, user: { roles: ['admin'] } }, rAdmin);
  assert.equal(rAdmin.body[0].paid, true);
  assert.equal(rAdmin.body[0].clientPhone, '+33600000000');
});

test('planning-events: reception-only when roles also include a non-admin role', () => {
  const model = { listPlanningEvents: () => [fullEvent()] };
  const c = buildResourceBookings(model);
  const r = res();
  c.planningEvents({ query: { from: '2026-07-01', to: '2026-07-31' }, user: { roles: ['reception', 'accountant'] } }, r);
  assert.equal('paid' in r.body[0], false);
});

// ---------- DATA-1: bounded range ----------

test('checkPlanningRange: ok, inverted, bad ISO, and the width ceiling', () => {
  assert.equal(checkPlanningRange('2026-01-01', '2026-02-01'), null);
  assert.deepEqual(checkPlanningRange('2026-02-01', '2026-01-01'), { status: 400, error: 'INVALID_DATE_RANGE' });
  assert.deepEqual(checkPlanningRange('nope', '2026-01-01'), { status: 400, error: 'INVALID_DATE_RANGE' });
  // exactly at the ceiling is allowed; one day over is rejected.
  const base = '2026-01-01';
  const atCeiling = new Date(Date.parse(base + 'T00:00:00Z') + MAX_PLANNING_RANGE_DAYS * 86400000).toISOString().slice(0, 10);
  assert.equal(daysBetween(base, atCeiling), MAX_PLANNING_RANGE_DAYS);
  assert.equal(checkPlanningRange(base, atCeiling), null);
  const overCeiling = new Date(Date.parse(base + 'T00:00:00Z') + (MAX_PLANNING_RANGE_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(checkPlanningRange(base, overCeiling), { status: 400, error: 'DATE_RANGE_TOO_WIDE' });
  assert.equal(isIsoDate('2026-13-99'), true); // shape-only check, as documented
});

test('planning-events rejects a pathological span before hitting the DB', () => {
  let called = false;
  const model = { listPlanningEvents: () => { called = true; return []; } };
  const c = buildResourceBookings(model);
  const r = res();
  c.planningEvents({ query: { from: '0001-01-01', to: '9999-12-31' }, user: { roles: ['admin'] } }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'DATE_RANGE_TOO_WIDE');
  assert.equal(called, false, 'the model must not be queried for an out-of-bounds range');
});

test('laundrySummary rejects a pathological span before the ledger walks it', () => {
  let touched = false;
  const trap = new Proxy({}, { get() { touched = true; return () => { throw new Error('ledger should not run'); }; } });
  const c = buildPlanning({
    settingsModel: { read: () => ({ laundryWeekday: 2 }) },
    laundryModel: trap, linenInventoryModel: trap, laundryTripSkipsModel: trap,
    laundryManualAdditionsModel: trap, laundryExtraTripsModel: trap,
  });
  const r = res();
  c.laundrySummary({ query: { from: '0001-01-01', to: '9999-12-31' } }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'DATE_RANGE_TOO_WIDE');
  assert.equal(touched, false);
});
