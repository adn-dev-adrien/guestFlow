// specs/qonto-bank-reconciliation.md §4.3, rules 12, 19–22, 24–28, 34–39 — the reconciliation end to
// end on the app's own schema: proposals, confirmation that marks the fiche through the core mark,
// « Défaire », scope, the fiche block and the home subject.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const bookingCredit = (id, cents, over = {}) => credit(id, cents, { counterpartyName: 'Booking.com B.V.', label: 'Booking.com B.V.', reference: 'NO.x/ID.1', ...over });

test('rules 34–36 — confirming a platform payout marks the fiche received at the bank date and carries the payout and its commission', () => {
  const id = addReservation({ platform: 'Booking', finalPrice: 710.02, balanceAmount: 710.02, platformGrossAmount: 710.02, balanceDueDate: '2026-11-18' });
  const { controller, transactions } = build();
  transactions.upsertMany([bookingCredit('t1', 59658)], { bankAccountId: 'acc-1' });

  const before = controller.list({ view: 'todo' }).body;
  const item = before.items.find((i) => i.reservation.id === id);
  assert.equal(item.state, 'proposed');
  assert.equal(item.proposal.confidence, 'verifier', 'rule 32: the fiche carries no payout yet');

  const answer = controller.confirm({ transactionId: 't1', allocations: item.proposal.allocations, user: USER });
  assert.equal(answer.status, 201);
  assert.equal(answer.body.marked.length, 1);
  const fiche = row(id);
  assert.equal(fiche.balancePaid, 1);
  assert.equal(fiche.balancePaidDate, '2026-10-12', 'the date of the credit (rule 35)');
  assert.equal(fiche.platformPayoutAmount, 596.58);
  assert.equal(fiche.platformCommissionAmount, 113.44);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).map((h) => h.changedFields).join(' ');
  assert.match(history, /Rapprochement bancaire/);

  const done = controller.list({ view: 'done' }).body.items.find((i) => i.reservation.id === id);
  assert.equal(done.state, 'reconciled');
});

test('rule 38 — « Défaire » restores the fiche: unpaid again, payout and commission back to what they were', () => {
  const id = addReservation({ platform: 'Booking', finalPrice: 710.02, balanceAmount: 710.02, platformGrossAmount: 710.02, balanceDueDate: '2026-11-18' });
  const { controller, transactions } = build();
  transactions.upsertMany([bookingCredit('t1', 59658)], { bankAccountId: 'acc-1' });
  const item = controller.list().body.items.find((i) => i.reservation.id === id);
  controller.confirm({ transactionId: 't1', allocations: item.proposal.allocations, user: USER });

  const undone = controller.undo({ transactionId: 't1', user: USER });
  assert.equal(undone.body.restored.length, 1);
  const fiche = row(id);
  assert.equal(fiche.balancePaid, 0);
  assert.equal(fiche.platformPayoutAmount, null);
  assert.equal(fiche.platformCommissionAmount ?? 0, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 0);
});

test('rule 38 — a fiche edited since the confirmation is left alone by « Défaire »', () => {
  const id = addReservation({ platform: 'Booking', finalPrice: 710.02, balanceAmount: 710.02, platformGrossAmount: 710.02, balanceDueDate: '2026-11-18' });
  const { controller, transactions } = build();
  transactions.upsertMany([bookingCredit('t1', 59658)], { bankAccountId: 'acc-1' });
  const item = controller.list().body.items.find((i) => i.reservation.id === id);
  controller.confirm({ transactionId: 't1', allocations: item.proposal.allocations, user: USER });
  db.prepare("UPDATE reservations SET balancePaidDate = '2026-10-13' WHERE id = ?").run(id);

  const undone = controller.undo({ transactionId: 't1', user: USER });
  assert.equal(undone.body.restored.length, 0);
  assert.equal(undone.body.untouched.length, 1);
  assert.equal(row(id).balancePaid, 1, 'the operator\'s edit stands');
});

test('rule 36 — a direct échéance of another amount is marked received, its amount never changed, the gap stays', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 75000, { counterpartyName: 'M. OU MME DUPONT' })], { bankAccountId: 'acc-1' });
  const answer = controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 75000 }], user: USER });
  assert.equal(answer.status, 201);
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).balanceAmount, 700);
  const item = controller.list({ view: 'todo' }).body.items.find((i) => i.reservation.id === id);
  assert.equal(item.state, 'amount_gap');
  assert.match(item.fixText, /Le virement fait 750,00 €, la fiche attend 700,00 €/);
});

test('rule 37 — a partial cover marks nothing; the second credit completes it at its own date', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 30000), credit('t2', 40000, { settledAt: '2026-10-15T08:00:00.000Z' })], { bankAccountId: 'acc-1' });
  const first = controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 30000 }], user: USER });
  assert.equal(first.body.marked.length, 0);
  assert.equal(row(id).balancePaid, 0);
  assert.equal(controller.list({ view: 'waiting' }).body.items.find((i) => i.reservation.id === id).state, 'partial');
  const second = controller.confirm({ transactionId: 't2', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 40000 }], user: USER });
  assert.equal(second.body.marked.length, 1);
  assert.equal(row(id).balancePaidDate, '2026-10-15');
});

test('rule 34 — a refusal of the core mark cancels the whole confirmation', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const refuse = () => ({ status: 409, body: { error: 'Le montant a changé entre-temps : relire la fiche.', code: 'AMOUNT_CHANGED' } });
  const { controller, transactions } = build({ mark: refuse });
  transactions.upsertMany([credit('t1', 70000)], { bankAccountId: 'acc-1' });
  const answer = controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.code, 'AMOUNT_CHANGED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 0, 'no reconciliation stored');
});

test('rule 34 — an échéance already marked received is reconciled without any write on the fiche', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700, balancePaid: 1, balancePaidDate: '2026-10-12' });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { counterpartyName: 'Dupont' })], { bankAccountId: 'acc-1' });
  const answer = controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  assert.deepEqual(answer.body.marked, []);
  assert.equal(answer.body.notWritten[0].reason, 'already-received');
  assert.equal(controller.list({ view: 'done' }).body.items.find((i) => i.reservation.id === id).state, 'reconciled');
});

test('§4.3 — validation: unknown credit, over-allocation, out of scope, unknown receipt', () => {
  const inScope = addReservation({});
  const past = addReservation({ startDate: '2026-08-01', endDate: '2026-08-03' });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 10000)], { bankAccountId: 'acc-1' });
  const alloc = (reservationId, ledgerKey = 'balance', amountCents = 5000) => [{ reservationId, ledgerKey, amountCents }];
  assert.equal(controller.confirm({ transactionId: 'nope', allocations: alloc(inScope), user: USER }).status, 404);
  assert.equal(controller.confirm({ transactionId: 't1', allocations: alloc(inScope, 'balance', 20000), user: USER }).body.code, 'ALLOCATION_EXCEEDS_TRANSACTION');
  assert.equal(controller.confirm({ transactionId: 't1', allocations: alloc(past), user: USER }).body.code, 'RESERVATION_OUT_OF_SCOPE');
  assert.equal(controller.confirm({ transactionId: 't1', allocations: alloc(inScope, 'deposit'), user: USER }).body.code, 'UNKNOWN_RECEIPT');
  assert.equal(controller.confirm({ transactionId: 't1', allocations: [], user: USER }).body.code, 'INVALID_ALLOCATION');
});

test('rule 1 — nothing answers without a Qonto connection', () => {
  const { controller } = build({ connected: false });
  assert.equal(controller.list().status, 409);
  assert.equal(controller.list().body.code, 'QONTO_NOT_CONNECTED');
  assert.equal(controller.buildFicheBlock({ id: 1 }), null);
});

test('rule 11 — a discarded pair is not proposed again', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { counterpartyName: 'Dupont' })], { bankAccountId: 'acc-1' });
  assert.ok(controller.list().body.items.find((i) => i.reservation.id === id).proposal);
  controller.discard({ transactionId: 't1', reservationId: id, ledgerKey: 'balance' });
  assert.equal(controller.compute().items.find((i) => i.reservation.id === id).proposal, null);
});

test('rule 17 — a credit marked « Hors réservation » leaves the proposals and the unmatched list', () => {
  addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([bookingCredit('t1', 12345)], { bankAccountId: 'acc-1' });
  assert.equal(controller.list({ view: 'todo' }).body.credits.length, 1);
  controller.setOutside({ transactionId: 't1', outside: true, user: USER });
  assert.equal(controller.list({ view: 'todo' }).body.credits.length, 0);
  assert.equal(controller.list({ view: 'other' }).body.credits[0].status, 'outside');
});

test('rules 25–27 — the fiche block: in scope only, stored data only, folded when everything is reconciled', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const past = addReservation({ startDate: '2026-08-01', endDate: '2026-08-03' });
  const { controller, transactions, calls } = build();
  transactions.upsertMany([credit('t1', 70000, { counterpartyName: 'Dupont' })], { bankAccountId: 'acc-1' });
  const block = controller.buildFicheBlock({ id });
  assert.equal(block.lines.length, 1);
  assert.equal(block.allReconciled, false);
  assert.equal(block.lines[0].proposal.bank.amountCents, 70000);
  assert.equal(controller.buildFicheBlock({ id: past }), null, 'out of scope: no card');
  controller.confirm({ transactionId: 't1', allocations: block.lines[0].proposal.allocations, user: USER });
  assert.equal(controller.buildFicheBlock({ id }).allReconciled, true);
  assert.equal(calls.qonto, 0, 'the block never calls Qonto');
});

test('rule 22 — the home subject counts the gaps and the unmatched credits', () => {
  addReservation({ balanceAmount: 700, finalPrice: 700, balanceDueDate: '2026-09-01' });
  const { controller, transactions } = build();
  transactions.upsertMany([bookingCredit('t1', 12345)], { bankAccountId: 'acc-1' });
  const payload = controller.attention();
  assert.equal(payload.gaps, 1, 'late');
  assert.equal(payload.unmatched, 1);
  const { summarize } = require('../reconciliation/attention');
  assert.deepEqual(summarize(payload), { count: 2, title: 'Écarts de règlement', detail: '1 écart · 1 virement non rattaché', severity: 'todo' });
  assert.equal(summarize({ gaps: 0, unmatched: 0 }), null);
});

test('rule 24 — the erasure lists what it drops and the tables it owns', () => {
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 100)], { bankAccountId: 'acc-1' });
  assert.deepEqual(controller.describeData(), [{ label: 'virements lus sur le compte Qonto', count: 1 }]);
});

test('rule 5 — « Actualiser » is throttled to one read a minute', async () => {
  const { controller, calls } = build();
  assert.equal((await controller.readNow()).status, 200);
  assert.equal((await controller.readNow()).body.code, 'READ_TOO_SOON');
  assert.equal(calls.read, 1);
});

test('rule 2 — the start date defaults to the day the feature is first opened', () => {
  const { controller, store } = build();
  store.delete('reconciliationStartDate');
  assert.equal(controller.list().body.startDate, '2026-10-23');
  assert.equal(store.get('reconciliationStartDate'), '2026-10-23');
});

test('rule 18 — manual linking: the candidates of the dialog, an allocation spread over two échéances of one credit', () => {
  const a = addReservation({ balanceAmount: 400, finalPrice: 400 });
  const b = addReservation({ clientId: 2, balanceAmount: 300, finalPrice: 300 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000)], { bankAccountId: 'acc-1' });
  const found = controller.candidates({ q: 'rossi' }).body.others.items;
  assert.deepEqual(found.map((i) => i.reservation.id), [b], 'the dialog filters by client');
  const answer = controller.confirm({ transactionId: 't1', allocations: [
    { reservationId: a, ledgerKey: 'balance', amountCents: 40000 },
    { reservationId: b, ledgerKey: 'balance', amountCents: 30000 },
  ], user: USER });
  assert.equal(answer.body.marked.length, 2, 'one credit settles two fiches');
  assert.equal(row(a).balancePaid, 1);
  assert.equal(row(b).balancePaid, 1);
  assert.equal(controller.undo({ transactionId: 't1', user: USER }).body.restored.length, 2);
});
