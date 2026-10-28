// specs/linen-laundry-days.md §3.3 rule 18 — the Dashboard shortage alert says when a shortage ends, and
// names the bath mat. (The alert itself: dashboard-controller-linen.unit.test.js.)
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../shortageController');

function makeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const short = (firstDate, maxMissing, recoversOn, ids = []) => ({ firstDate, maxMissing, recoversOn, impactedReservationIds: ids });
const none = () => short(null, 0, null);

function alertFor(shortagesByType) {
  const controller = buildController({
    linenInventoryModel: { simulate: () => ({ horizon: '2026-07-30', days: [], shortagesByType }) },
    reservationsModel: { findClientNamesByIds: () => [] },
  });
  const res = makeRes();
  controller.linenShortage({}, res);
  return res.body;
}

test('specs/linen-laundry-days.md §3.3 rule 18: each type carries recoversOn, the first date with a clean sheet for everyone again', () => {
  const body = alertFor({ single: short('2026-06-24', 3, '2026-06-28', [1]), double: none() });
  assert.equal(body.shortagesByType.length, 1);
  assert.equal(body.shortagesByType[0].type, 'single');
  assert.equal(body.shortagesByType[0].firstShortageDate, '2026-06-24');
  assert.equal(body.shortagesByType[0].recoversOn, '2026-06-28');
});

test('specs/linen-laundry-days.md §3.3 rule 18: recoversOn is null when the shortage lasts to the end of the horizon', () => {
  const body = alertFor({ double: short('2026-06-24', 1, null, [2]) });
  assert.equal(body.shortagesByType[0].recoversOn, null);
});

test('specs/linen-laundry-days.md §3.3 rule 18: a bath-mat shortage reads « Tapis de bain », not « bathMat »', () => {
  const body = alertFor({ bathMat: short('2026-06-24', 2, '2026-06-26', [3]) });
  assert.equal(body.shortagesByType[0].type, 'bathMat');
  assert.equal(body.shortagesByType[0].label, 'Tapis de bain');
});

test('specs/linen-laundry-days.md §3.3 rule 18: every linen type has a label of its own', () => {
  const all = {};
  for (const type of ['single', 'double', 'baby', 'large', 'medium', 'small', 'bathMat']) all[type] = short('2026-06-24', 1, null, [1]);
  const labels = alertFor(all).shortagesByType.map((s) => s.label);
  assert.equal(new Set(labels).size, 7);
  assert.ok(labels.every((l) => !/^[a-z]+[A-Z]/.test(l) && l !== 'bathMat'));
});

test('specs/linen-laundry-days.md §3.3 rule 18: no shortage, no entry', () => {
  assert.deepEqual(alertFor({ single: none() }).shortagesByType, []);
});
