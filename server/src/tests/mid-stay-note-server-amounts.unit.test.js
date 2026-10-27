/**
 * specs/mid-stay-notes.md rule 22 (audit 2026-10-27) — the « Nouvelle note » amounts are the server's.
 *
 * The dialog used to compute `added = live − base`, the ticked share, the rounding and the total in
 * React, and the server only checked `amount ≤ remaining`. It now sends the ticked keys and the
 * remainder it opened on; the server derives each amount (preview and settlement) and the total.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { planMidStayNote } = require('../utils/midStayNotePlan');

const OPENING = [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 24 }, { key: 'res:3', label: 'Location vélo', amount: 18 }];

test('rule 22 — nothing ticked, nothing added → an empty note', () => {
  assert.deepEqual(planMidStayNote({ opening: OPENING, current: OPENING, checkedKeys: [] }), { items: [], total: 0 });
});

test('rule 22 — a ticked line is collected for what was due on opening', () => {
  assert.deepEqual(planMidStayNote({ opening: OPENING, current: OPENING, checkedKeys: ['res:3'] }),
    { items: [{ key: 'res:3', label: 'Location vélo', amount: 18 }], total: 18 });
});

test('rule 22 — a catalogue addition on a key is collected for its delta only, ticked or not', () => {
  const current = [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 34 }, OPENING[1]];
  assert.deepEqual(planMidStayNote({ opening: OPENING, current, checkedKeys: [] }),
    { items: [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 10 }], total: 10 });
  assert.deepEqual(planMidStayNote({ opening: OPENING, current, checkedKeys: ['opt:9', 'res:3'] }).total, 52);
});

test('rule 22 — a brand-new key carries its live label; cents are rounded once, server-side', () => {
  const current = [...OPENING, { key: 'opt:14', label: 'Coca', amount: 2.1 }, { key: 'opt:14', label: 'Coca', amount: 2.2 }];
  assert.deepEqual(planMidStayNote({ opening: OPENING, current, checkedKeys: [] }),
    { items: [{ key: 'opt:14', label: 'Coca', amount: 4.3 }], total: 4.3 });
});

test('rule 22 — a remainder that shrank since opening caps the ticked share at what is left', () => {
  const current = [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 12 }, OPENING[1]];
  assert.deepEqual(planMidStayNote({ opening: OPENING, current, checkedKeys: ['opt:9'] }).items,
    [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 12 }]);
});

test('rule 22 — garbage in (no arrays, unknown keys) is an empty note, never a throw', () => {
  assert.deepEqual(planMidStayNote({ opening: null, current: 'x', checkedKeys: ['opt:404'] }), { items: [], total: 0 });
  assert.deepEqual(planMidStayNote(), { items: [], total: 0 });
});

// ── the HTTP side: preview and settlement ───────────────────────────────────

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildController({ settled, storedLines }) {
  const origRequire = Module.prototype.require;
  const dbMock = { transaction: (fn) => (...a) => fn(...a), prepare: () => ({ get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }) };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getBasic') return () => ({ id: 1 });
    if (k === 'getRow') return () => ({ id: 1, kind: 'reservation', endOfStayComplementDetail: JSON.stringify(storedLines) });
    if (k === 'settleMidStayNote') return (id, args) => { settled.push({ id, ...args }); return { id: 1 }; };
    return () => null;
  } });
  const modules = {
    '../utils/pricing': { calculateReservationQuote: () => ({}) },
    '../utils/financeValidation': require('../utils/financeValidation'),
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-07-01' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': reservationsModelMock,
    '../models/settingsModel': { read: () => ({}) },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  };
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  } finally { Module.prototype.require = origRequire; }
}

test('rule 22 — POST /reservations/mid-stay-note/preview answers the items and the total', () => {
  const controller = buildController({ settled: [], storedLines: [] });
  const res = fakeRes();
  controller.previewMidStayNote({ body: { opening: OPENING, current: OPENING, checkedKeys: ['opt:9'] } }, res);
  assert.deepEqual(res.body, { items: [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 24 }], total: 24 });
});

test('rule 22 — settling derives the amounts from the STORED remainder, never from client amounts', () => {
  const settled = [];
  // The fiche was saved first: the stored remainder holds the 10 € the dialog added on opt:9.
  const storedLines = [
    { label: 'Ménage', amount: 60, source: 'sas' },
    { label: 'Petit-déjeuner', amount: 34, key: 'opt:9', source: 'midStayExtra' },
    { label: 'Location vélo', amount: 18, key: 'res:3', source: 'midStayExtra' },
  ];
  const controller = buildController({ settled, storedLines });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body: {
    settleMidStayNote: { checkedKeys: ['res:3'], opening: OPENING, cash: true, items: [{ key: 'opt:9', amount: 999 }] },
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(settled, [{ id: 1, cash: true, items: [
    { key: 'opt:9', label: 'Petit-déjeuner', amount: 10 },
    { key: 'res:3', label: 'Location vélo', amount: 18 },
  ] }]);
});
