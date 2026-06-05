const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryTripSkipsModel = require('../models/laundryTripSkipsModel');
const laundryTripSkipsController = require('../controllers/laundryTripSkipsController');

// specs/skip-laundry-trip.md §4.3 + §7.1 — endpoint-shape coverage for the GET/POST/DELETE
// trio. Drives the controller via mock req/res. Role enforcement (admin-only) is owned by
// the global `enforceRoleAccess` middleware which has its own dedicated test suite — we
// don't re-test it here, we just confirm the handlers themselves don't add a second guard.

const DDL = `
  CREATE TABLE IF NOT EXISTS laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function freshController() {
  const db = new Database(':memory:');
  db.exec(DDL);
  const model = laundryTripSkipsModel.create(db);
  const ctrl = laundryTripSkipsController.create(model);
  return { ctrl, model, db };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('GET /skips returns the persisted list', () => {
  const { ctrl, model } = freshController();
  model.add('2026-06-09');
  model.add('2026-06-23');
  const res = makeRes();
  ctrl.listSkips({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { skips: ['2026-06-09', '2026-06-23'] });
});

test('POST /skips adds the date and returns the full list', () => {
  const { ctrl, model } = freshController();
  const res = makeRes();
  ctrl.addSkip({ body: { date: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.skips, ['2026-06-09']);
  assert.equal(model.isSkipped('2026-06-09'), true);
});

test('POST /skips with an already-skipped date is idempotent (200 + no duplicate)', () => {
  const { ctrl, model } = freshController();
  model.add('2026-06-09');
  const res = makeRes();
  ctrl.addSkip({ body: { date: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.skips, ['2026-06-09']);
  assert.equal(model.count(), 1);
});

test('DELETE /skips/:date removes the date and returns the updated list', () => {
  const { ctrl, model } = freshController();
  model.add('2026-06-09');
  model.add('2026-06-16');
  const res = makeRes();
  ctrl.removeSkip({ params: { date: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.skips, ['2026-06-16']);
  assert.equal(model.isSkipped('2026-06-09'), false);
});

test('DELETE /skips/:date on a non-skipped date is idempotent (200, list unchanged)', () => {
  const { ctrl, model } = freshController();
  model.add('2026-06-16');
  const res = makeRes();
  ctrl.removeSkip({ params: { date: '2026-06-09' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.skips, ['2026-06-16']);
});

test('POST /skips with a malformed date returns 400 + INVALID_DATE code', () => {
  const { ctrl } = freshController();
  for (const bad of ['2026/06/09', '2026-6-9', '2026-13-99', 'not-a-date', '', undefined, null]) {
    const res = makeRes();
    ctrl.addSkip({ body: { date: bad } }, res);
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(bad)}, got ${res.statusCode}`);
    assert.equal(res.body.code, 'INVALID_DATE');
  }
});

test('DELETE /skips/:date with a malformed date returns 400 + INVALID_DATE code', () => {
  const { ctrl } = freshController();
  const res = makeRes();
  ctrl.removeSkip({ params: { date: '2026/06/09' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_DATE');
});
