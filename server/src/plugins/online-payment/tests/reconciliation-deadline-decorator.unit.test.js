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

test('rules 22, 37 — an overdue row with a proposal says which transfer was found; only a « sûr » one carries its proposal id', () => {
  const id = late();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { settledAt: at('2026-10-12'), counterpartyName: 'M. DUPONT' })], { bankAccountId: 'acc-1' });
  const [decorated] = controller.decorateDeadlines([row(id)]);
  assert.equal(decorated.bank.state, 'proposed');
  assert.equal(decorated.bank.label, 'Virement trouvé : 700,00 € le 12/10');
  assert.equal(decorated.bank.confidence, 'probable');
  assert.equal(decorated.bank.proposalId, null, 'a name and an amount: checked on the fiche, not one click on the home');
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

test('rules 22, 37 — a « sûr » proposal gets the one-click confirmation', () => {
  const id = addReservation({ platform: 'Booking', platformGrossAmount: 800, platformPayoutAmount: 700, finalPrice: 800, balanceAmount: 800, depositAmount: 0, balanceDueDate: '2026-10-01' });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t9', 70000, { settledAt: at('2026-10-02'), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.1' })], { bankAccountId: 'acc-1' });
  const [decorated] = controller.decorateDeadlines([row(id)]);
  assert.equal(decorated.bank.confidence, 'sur');
  assert.equal(decorated.bank.proposalId, `t9:${id}|balance`);
});

test('rules 22, 37 — the words follow the state: arrived but not recorded, received in part, another amount', () => {
  const id = late();
  const { controller, transactions, model } = build();
  transactions.upsertMany([credit('t1', 20000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  model.addLine({ transactionId: 't1', reservationId: id, ledgerKey: 'balance', amountCents: 20000 });
  assert.equal(controller.decorateDeadlines([row(id)])[0].bank.state, 'partial');
  assert.match(controller.decorateDeadlines([row(id)])[0].bank.label, /Reçu en partie : 200,00 € sur 700,00 €/);
  transactions.upsertMany([credit('t2', 50000, { settledAt: at('2026-10-14') })], { bankAccountId: 'acc-1' });
  model.addLine({ transactionId: 't2', reservationId: id, ledgerKey: 'balance', amountCents: 50000 });
  const rec = controller.decorateDeadlines([row(id)])[0].bank;
  assert.equal(rec.state, 'received');
  assert.match(rec.label, /Virement arrivé le 14\/10 : marquer reçu sur la fiche/);
});

test('rules 22, 37 — a row about acompte and solde is decorated from the first échéance still open', () => {
  const id = addReservation({ depositAmount: 300, depositDueDate: '2026-09-20', balanceAmount: 400, finalPrice: 700, balanceDueDate: '2026-10-01' });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('tb', 40000, { settledAt: at('2026-10-02'), counterpartyName: 'M. DUPONT' })], { bankAccountId: 'acc-1' });
  const [decorated] = controller.decorateDeadlines([row(id, { depositDue: 300, balanceDue: 400, totalDue: 700 })]);
  assert.equal(decorated.bank.state, 'nothing', 'the acompte is the first open échéance and nothing matches it');
});
