// specs/reconciliation-assisted-matching.md rule 11 — a counter of the page is a filter, computed by the
// server. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;

// One gap (750 € on a 700 € échéance), one proposal, one unmatched platform credit, one reconciled receipt.
function world() {
  const gap = addReservation({ balanceAmount: 700, finalPrice: 700, clientId: 1 });
  const proposed = addReservation({ balanceAmount: 410, finalPrice: 410, clientId: 2, balanceDueDate: '2026-10-10' });
  const done = addReservation({ balanceAmount: 120, finalPrice: 120, clientId: 1, balanceDueDate: '2026-10-05' });
  const built = build();
  built.transactions.upsertMany([
    credit('gap', 75000, { settledAt: at('2026-10-12'), counterpartyName: 'ACME' }),
    credit('prop', 41000, { settledAt: at('2026-10-11'), counterpartyName: 'M. ROSSI' }),
    credit('done', 12000, { settledAt: at('2026-10-06'), counterpartyName: 'Dupont' }),
    credit('orphan', 99999, { settledAt: at('2026-10-13'), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.1' }),
  ], { bankAccountId: 'acc-1' });
  built.controller.confirm({ transactionId: 'gap', allocations: [{ reservationId: gap, ledgerKey: 'balance', amountCents: 75000 }], user: USER });
  built.controller.confirm({ transactionId: 'done', allocations: [{ reservationId: done, ledgerKey: 'balance', amountCents: 12000 }], user: USER });
  return { ...built, gap, proposed, done };
}

test('rule 11 — « Écarts » shows only the gaps', () => {
  const { controller, gap } = world();
  const body = controller.list({ view: 'todo', filter: 'gaps' }).body;
  assert.deepEqual(body.items.map((i) => i.reservation.id), [gap]);
  assert.equal(body.credits.length, 0);
  assert.equal(body.filter, 'gaps');
});

test('rule 11 — « À confirmer » shows only the proposals, with their bulk summary', () => {
  const { controller, proposed } = world();
  const body = controller.list({ view: 'todo', filter: 'proposed' }).body;
  assert.deepEqual(body.items.map((i) => i.reservation.id), [proposed]);
  assert.equal(body.credits.length, 0);
  assert.equal(body.bulk.count + body.bulk.toVerify.count, 1);
});

test('rule 11 — « Non rattachés » shows only the credits no fiche claims', () => {
  const { controller } = world();
  const body = controller.list({ view: 'todo', filter: 'unmatched' }).body;
  assert.equal(body.items.length, 0);
  assert.deepEqual(body.credits.map((c) => c.transactionId), ['orphan']);
});

test('rule 11 — « Rapprochés » shows only the reconciled receipts of the done view', () => {
  const { controller, done } = world();
  const body = controller.list({ view: 'done', filter: 'reconciled' }).body;
  assert.deepEqual(body.items.map((i) => i.reservation.id), [done]);
  assert.equal(controller.list({ view: 'todo', filter: 'reconciled' }).body.items.length, 0, 'the filter intersects with the view');
});

test('rule 11 — an unknown filter is ignored, not echoed', () => {
  const { controller } = world();
  const plain = controller.list({ view: 'todo' }).body;
  const unknown = controller.list({ view: 'todo', filter: 'nonsense' }).body;
  assert.equal(unknown.filter, null);
  assert.equal(unknown.items.length, plain.items.length);
  assert.equal(unknown.credits.length, plain.credits.length);
});
