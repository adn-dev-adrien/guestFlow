// specs/reconciliation-assisted-matching.md rule 22 — the core side of the « Échéances » decoration: a generic,
// inert hook. No decorator → rows unchanged; a decorator rewrites them; one that throws changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { decorateDeadlineRows } = require('../utils/pluginPaymentDeadlineDecorators');

const rows = [{ reservationId: 1, state: 'balance_overdue' }, { reservationId: 2, state: 'deposit_overdue' }];

test.beforeEach(() => { registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.after(() => { registry.reset(); });

test('rule 22 — without a decorator the rows are returned as they are', () => {
  assert.deepEqual(decorateDeadlineRows(rows, { error: () => {} }), rows);
});

test('rule 22 — a live plugin\'s decorator can add a line and drop a row', () => {
  createContext('deco-ok', {}).paymentDeadlineDecorator((list) => list.filter((r) => r.reservationId !== 2).map((r) => ({ ...r, bank: { state: 'nothing' } })));
  assert.deepEqual(decorateDeadlineRows(rows, { error: () => {} }), [{ reservationId: 1, state: 'balance_overdue', bank: { state: 'nothing' } }]);
});

test('rule 22 — a decorator of an inactive plugin is ignored', () => {
  createContext('deco-off', {}).paymentDeadlineDecorator(() => []);
  registry.configure({ isActive: () => false });
  assert.deepEqual(decorateDeadlineRows(rows, { error: () => {} }), rows);
});

test('rule 22 — a decorator that throws leaves the rows unchanged and is logged', () => {
  createContext('deco-boom', {}).paymentDeadlineDecorator(() => { throw new Error('boom'); });
  const logged = [];
  assert.deepEqual(decorateDeadlineRows(rows, { error: (m) => logged.push(m) }), rows);
  assert.match(logged[0], /deco-boom.*boom/);
});

test('rule 22 — the context accepts one decorator per plugin, and only a function', () => {
  const ctx = createContext('deco-ctx', {});
  assert.throws(() => ctx.paymentDeadlineDecorator('nope'), /must be a function/);
  ctx.paymentDeadlineDecorator(() => []);
  assert.throws(() => ctx.paymentDeadlineDecorator(() => []), /already declared/);
});
