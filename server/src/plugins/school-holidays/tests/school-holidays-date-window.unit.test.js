// specs/reservations-backend-mvc.md rule 13 (past reading of 2026-11-02) on the school holidays — a period is
// entered on real days from today − 5 years to today + 5 years; a date the row already stores (an imported
// period) is not re-judged.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePeriod } = require('../validation');
const { createController } = require('../controller');
const { horizonStart, horizonEnd } = require('../../../utils/stayDates');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const S = horizonStart();
const H = horizonEnd();
const before = addDaysToIsoDate(S, -1);
const after = addDaysToIsoDate(H, 1);
const zoneA = (start, end) => ({ label: 'Toussaint', zoneA_start: start, zoneA_end: end });

test('a zone from today − 5 years to today + 5 years passes; one day outside, or an impossible day, is refused', () => {
  assert.equal(validatePeriod(zoneA(S, H)), null);
  assert.equal(validatePeriod(zoneA(before, H)), 'Zone A : date trop ancienne : 5 ans au plus.');
  assert.equal(validatePeriod(zoneA(S, after)), 'Zone A : date trop lointaine : 5 ans au plus.');
  assert.equal(validatePeriod(zoneA(`${S.slice(0, 4)}-02-30`, H)), 'Zone A : date invalide.');
  assert.equal(validatePeriod(zoneA(before, H), { stored: { zoneA_start: before } }), null);
});

test('create refuses a period outside the window and writes nothing; update keeps a stored date', () => {
  const rows = new Map([[1, { id: 1, ...zoneA(before, addDaysToIsoDate(before, 9)), externalRef: null }]]);
  const written = [];
  const controller = createController({
    model: {
      insert: (p) => { written.push(p); return { id: 2 }; },
      findById: (id) => rows.get(Number(id)) || null,
      update: (id, p) => written.push(p),
      lock: () => {},
    },
    sentenceCase: (v) => v,
    sync: async () => ({}),
  });
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const refused = res();
  controller.create({ body: zoneA(before, S) }, refused);
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.code, 'INVALID_PERIOD');
  assert.deepEqual(written, []);
  const kept = res();
  controller.update({ params: { id: '1' }, body: { ...zoneA(before, addDaysToIsoDate(before, 9)), label: 'Toussaint relue' } }, kept);
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  const moved = res();
  controller.update({ params: { id: '1' }, body: zoneA(addDaysToIsoDate(before, -1), addDaysToIsoDate(before, 9)) }, moved);
  assert.equal(moved.statusCode, 400);
  assert.equal(written.length, 1);
});
