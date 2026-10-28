// specs/reconciliation-assisted-matching.md rule 22 — the home's « Échéances » card knows the bank: a
// transfer found, nothing on the account, a reconciled échéance dropped; `late` leaves « Écarts de
// règlement ». Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;
const row = (reservationId, over = {}) => ({
  reservationId, state: 'balance_overdue', clientName: 'Jean Dupont', balanceDue: 700, depositDue: 0, totalDue: 700, ...over,
});
const late = () => addReservation({ balanceAmount: 700, finalPrice: 700, balanceDueDate: '2026-10-01' });

test('rule 22 — an overdue row with a proposal says which transfer was found and carries its proposal id', () => {
  const id = late();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { settledAt: at('2026-10-12'), counterpartyName: 'M. DUPONT' })], { bankAccountId: 'acc-1' });
  const [decorated] = controller.decorateDeadlines([row(id)]);
  assert.equal(decorated.bank.state, 'proposed');
  assert.equal(decorated.bank.label, 'Virement trouvé : 700,00 € le 12/10');
  assert.equal(decorated.bank.proposalId, 't1:' + id + '|balance');
  assert.equal(decorated.bank.amountCents, 70000);
  assert.equal(decorated.clientName, 'Jean Dupont', 'the rest of the row is untouched');
});

test('rule 22 — nothing on the account: « Rien sur le compte », the row stays', () => {
  const id = late();
  const { controller } = build();
  const [decorated] = controller.decorateDeadlines([row(id)]);
  assert.equal(decorated.bank.state, 'nothing');
  assert.equal(decorated.bank.label, 'Rien sur le compte');
});

test('rule 22 — an échéance reconciled since the card was computed leaves the card', () => {
  const id = late();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  assert.deepEqual(controller.decorateDeadlines([row(id)]), []);
});

test('rule 22 — rows that ask for no money yet, or a reservation outside the scope, are left alone', () => {
  const id = late();
  const past = addReservation({ startDate: '2026-08-01', endDate: '2026-08-03' });
  const { controller } = build();
  const toRequest = row(id, { state: 'balance_to_request' });
  const rows = [toRequest, row(past)];
  assert.deepEqual(controller.decorateDeadlines(rows), rows);
});

test('rule 22 — without a Qonto connection the rows come back unchanged', () => {
  const id = late();
  const { controller } = build({ connected: false });
  const rows = [row(id)];
  assert.deepEqual(controller.decorateDeadlines(rows), rows);
});

test('rule 22 — « late » leaves the count of « Écarts de règlement », the page still lists it', () => {
  late();
  const { controller } = build();
  assert.equal(controller.attention().gaps, 0);
  assert.equal(controller.list({ view: 'todo' }).body.counts.gaps, 1);
});
