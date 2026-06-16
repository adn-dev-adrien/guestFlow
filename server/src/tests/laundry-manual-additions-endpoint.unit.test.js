const test = require('node:test');
const assert = require('node:assert/strict');

// specs/manual-laundry-additions.md §4.3 — GET list + PUT upsert behind /api/laundry/manual-additions.
const { create } = require('../controllers/laundryManualAdditionsController');

const ZEROS = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// Minimal in-memory stub mirroring the real model's set/listAll contract (clamp + all-zero delete).
function stubModel() {
  const store = {};
  return {
    listAll: () => JSON.parse(JSON.stringify(store)),
    set: (date, counts) => {
      const c = { ...ZEROS, singleBeds: Math.max(0, Math.round(Number(counts.singleBeds) || 0)) };
      if (Object.values(c).every((v) => v === 0)) { delete store[date]; return { ...ZEROS }; }
      store[date] = c; return c;
    },
  };
}

test('GET → { additions } map', () => {
  const m = stubModel(); m.set('2026-06-09', { singleBeds: 2 });
  const res = fakeRes();
  create(m).listAdditions({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.additions), ['2026-06-09']);
});

test('PUT upserts + echoes counts; refreshes the list', () => {
  const m = stubModel();
  const res = fakeRes();
  create(m).setAddition({ params: { date: '2026-06-09' }, body: { singleBeds: 3 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.counts.singleBeds, 3);
  assert.equal(res.body.additions['2026-06-09'].singleBeds, 3);
});

test('PUT all-zero deletes the row', () => {
  const m = stubModel();
  create(m).setAddition({ params: { date: '2026-06-09' }, body: { singleBeds: 2 } }, fakeRes());
  const res = fakeRes();
  create(m).setAddition({ params: { date: '2026-06-09' }, body: { singleBeds: 0 } }, res);
  assert.deepEqual(res.body.additions, {});
});

test('PUT rejects a malformed date with 400', () => {
  const res = fakeRes();
  create(stubModel()).setAddition({ params: { date: '2026-13-99' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_DATE');
});
