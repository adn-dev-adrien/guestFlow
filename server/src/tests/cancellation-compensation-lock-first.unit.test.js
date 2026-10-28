// specs/cancellation-compensation.md rule 6 and rule 29 (spec review of 2026-10-27, agent 3 F7) — a received
// compensation is an accounting entry: any PUT on it answers 409 COMPENSATION_LOCKED, whatever its body.
// A body without platform used to be judged first and answered 400 PLATFORM_REQUIRED.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createController } = require('../controllers/cancellationCompensationsController');

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function build(status) {
  const updates = [];
  const model = {
    getById: (id) => (id === 404 ? null : { id, status }),
    update: (id, payload) => { updates.push([id, payload]); return status === 'received' ? { error: 'COMPENSATION_LOCKED', status: 409 } : { ok: true, data: { id } }; },
  };
  return { controller: createController(model, { today: () => '2026-10-27' }), updates };
}

test('rules 6 + 29 — PUT without platform on a received compensation: 409 COMPENSATION_LOCKED, not 400', () => {
  const { controller, updates } = build('received');
  const res = fakeRes();
  controller.update({ params: { id: '3' }, body: { expectedAmount: 84 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'COMPENSATION_LOCKED');
  assert.equal(updates.length, 0);
});

test('rule 6 — a pending compensation still has its payload judged', () => {
  const { controller } = build('pending');
  const res = fakeRes();
  controller.update({ params: { id: '3' }, body: { expectedAmount: 84 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PLATFORM_REQUIRED');
});
