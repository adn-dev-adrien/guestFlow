// specs/gites-de-france-mail-intake.md §4.1 — the fiche's save as a server-callable service:
// `performUpdate` (the HTTP handler minus Express), `toUpdateBody` (stored reservation → the PUT body),
// and `ctx.core.reservations.update` (both, for a plugin, refused on a started stay).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { createResultRecorder } = require('../utils/resultRecorder');
const { toUpdateBody } = require('../utils/reservationUpdateBody');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

test('result recorder: status + json, and json alone, are recorded as { status, body }', () => {
  const a = createResultRecorder();
  a.status(409).json({ error: 'x' });
  assert.deepEqual(a.result(), { status: 409, body: { error: 'x' } });
  const b = createResultRecorder();
  b.json({ ok: true });
  assert.deepEqual(b.result(), { status: 200, body: { ok: true } });
});

// The same controller harness as reservations-controller-edit-overlap: the engine and the model mocked.
function buildController({ availabilityError = null, captures }) {
  const PLACEMENT = { propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-12', adults: 2, children: 0, teens: 0, babies: 0 };
  return withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ totalPrice: 0, finalPrice: 100, depositAmount: 0, balanceAmount: 100, optionLines: [], resourceLines: [], nightlyBreakdown: [], nights: 2, error: null }) },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-06-04' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../models/reservationsModel': new Proxy({}, { get: (_, k) => {
      if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (k === 'validateAvailability') return () => availabilityError;
      if (k === 'updateReservation') return (id, payload) => { captures.updated = { id, payload }; };
      if (k === 'getReservationNumber') return () => 'R-1';
      if (k === 'getForUpdate') return () => PLACEMENT;
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({}) },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare() { return { get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }; } },
  }, () => {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  });
}

const BODY = { clientId: 1, platform: 'Airbnb', options: [], propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-13', adults: 2, children: 0, teens: 0, babies: 0 };

test('performUpdate answers what the HTTP save answers — success', () => {
  const captures = {};
  const controller = buildController({ captures });
  const result = controller.performUpdate('7', { ...BODY });
  assert.deepEqual(result, { status: 200, body: { ok: true, reservationNumber: 'R-1' } });
  assert.equal(captures.updated.id, 7);

  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  buildController({ captures: {} }).update({ params: { id: '7' }, body: { ...BODY } }, res);
  assert.deepEqual([res.code, res.body], [200, { ok: true, reservationNumber: 'R-1' }]);
});

test('performUpdate answers what the HTTP save answers — a refusal', () => {
  const controller = buildController({ captures: {}, availabilityError: { error: 'Ce logement est déjà réservé pour ces dates.' } });
  const result = controller.performUpdate('7', { ...BODY });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'Ce logement est déjà réservé pour ces dates.');
});

test('toUpdateBody: the stored reservation as the fiche sends it', () => {
  const stored = {
    propertyId: 1, clientId: 141, startDate: '2026-11-13', endDate: '2026-11-15', adults: 8, children: 2, teens: 0, babies: 2,
    singleBeds: 2, doubleBeds: 4, babyBeds: 2, checkInTime: null, checkOutTime: '10:00', platform: 'GitesDeFrance',
    touristTaxInComplement: 0, customPrice: '', platformGrossAmount: 603.2, platformCommissionAmount: '', depositAmountOverride: '',
    cautionAmount: 500, notes: '',
    options: [
      { optionId: 8, quantity: 1, offered: 1, inComplement: 0 },
      { optionId: 12, quantity: 1, offered: 0, inComplement: 1 },
      { optionId: 7, quantity: 1, offered: 0, inComplement: 0, cardOccurrences: [] },
      { isCustom: 1, customOptionId: 3, title: 'Panier', originalTotalPrice: 24, offered: 0, inComplement: 0 },
    ],
    resources: [{ resourceId: 2, quantity: 1, unitPrice: 30, offered: 0, inComplement: 1, sessions: [] }],
  };
  const body = toUpdateBody(stored, new Set([12]));
  assert.equal(body.reservationNumber, '', 'blank keeps the stored number');
  assert.equal(body.checkInTime, '15:00');
  assert.deepEqual(body.options, [{ optionId: 8, quantity: 1, inComplement: 0 }, { optionId: 7, quantity: 1, inComplement: 0 }]);
  assert.deepEqual(body.offeredOptionIds, [8]);
  assert.deepEqual(body.autoOptionsInComplement, [12]);
  assert.deepEqual(body.customOptions, [{ customKey: '3', customOptionId: 3, description: 'Panier', amount: 24, offered: false, inComplement: 0 }]);
  assert.deepEqual(body.resources, [{ resourceId: 2, quantity: 1, unitPrice: 30, offered: false, inComplement: 1, sessions: [] }]);
  assert.equal(body.platformGrossAmount, 603.2);
  assert.equal(body.platformCommissionAmount, null);
  assert.equal(body.depositAmountOverride, null);
});

// coreServices requires the core lazily, at call time: the mocks wrap the call, not the require.
function freshCore() {
  delete require.cache[require.resolve('../plugins/sdk/coreServices')];
  return require('../plugins/sdk/coreServices');
}

test('ctx.core.reservations.update: stored state + patch through the save path, with a history line', () => {
  const captures = {};
  const core = freshCore();
  const result = withMocks({
    '../../models/reservationsModel': {
      getByIdWithDetails: () => ({ id: 5, kind: 'reservation', startDate: '2026-11-13', propertyId: 1, adults: 1, options: [], resources: [] }),
      addHistoryEntry: (id, type, changes) => { captures.history = { id, type, changes }; },
    },
    '../../controllers/reservationsController': { performUpdate: (id, body) => { captures.body = body; return { status: 200, body: { ok: true } }; } },
    '../../utils/reservationHelpers': { getTodayIsoDate: () => '2026-10-15' },
    '../../utils/reservationUpdateBody': require('../utils/reservationUpdateBody'),
    '../../database': { prepare: () => ({ all: () => [] }) },
  }, () => core.reservations.update(5, { adults: 8 }, { label: 'Mail Gîtes de France du 14/10' }));
  assert.equal(result.status, 200);
  assert.equal(captures.body.adults, 8);
  assert.equal(captures.body.propertyId, 1);
  assert.deepEqual(captures.history.changes, [{ field: 'source', label: 'Origine', from: null, to: 'Mail Gîtes de France du 14/10' }]);
});

test('rule 17: ctx.core.reservations.update — a started or past stay stays the operator’s', () => {
  const captures = {};
  const core = freshCore();
  const result = withMocks({
    '../../models/reservationsModel': { getByIdWithDetails: () => ({ id: 5, kind: 'reservation', startDate: '2026-10-15', options: [] }) },
    '../../utils/reservationHelpers': { getTodayIsoDate: () => '2026-10-15' },
  }, () => core.reservations.update(5, { adults: 8 }));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'PAST_RESERVATION');
  assert.equal(captures.body, undefined);
});
