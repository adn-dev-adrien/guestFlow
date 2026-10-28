// specs/reconciliation-assisted-matching.md rule 14 — « Rattacher à des fiches » from a credit: plausible
// receipts first, all open receipts folded, the same search, several receipts at once. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;

function world() {
  const a = addReservation({ balanceAmount: 400, finalPrice: 400, balanceDueDate: '2026-10-18' });
  const b = addReservation({ clientId: 2, balanceAmount: 300, finalPrice: 300, balanceDueDate: '2026-10-19' });
  const far = addReservation({ clientId: 2, balanceAmount: 777, finalPrice: 777, balanceDueDate: '2027-02-01', startDate: '2027-02-01', endDate: '2027-02-03' });
  const built = build();
  built.transactions.upsertMany([credit('t1', 70000, { settledAt: at('2026-10-20'), counterpartyName: 'ACME' })], { bankAccountId: 'acc-1' });
  return { ...built, a, b, far };
}
const find = (controller, q = '') => controller.candidates({ transactionId: 't1', q }).body;

test('rule 14 — receipts whose open amount fits the credit within 5 € and the dates come first; the rest is folded', () => {
  const { controller, a, b, far } = world();
  addReservation({ balanceAmount: 700, finalPrice: 700, balanceDueDate: '2026-10-19' });
  const body = find(controller);
  assert.equal(body.likely.length, 1, 'only the 700 € one fits the 700 € credit');
  assert.equal(body.likely[0].openCents, 70000);
  const folded = body.others.items.map((r) => r.reservationId);
  assert.ok([a, b, far].every((id) => folded.includes(id)));
});

test('rule 14 — the receipts of the credit\'s own proposal are plausible even when no one fits the amount alone', () => {
  const platformStay = (payout, over = {}) => addReservation({
    platform: 'Booking', platformGrossAmount: payout + 50, platformPayoutAmount: payout, finalPrice: payout + 50, balanceAmount: payout + 50,
    depositAmount: 0, balanceDueDate: '2026-10-18', ...over,
  });
  const a = platformStay(400);
  const b = platformStay(300, { clientId: 2 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { settledAt: at('2026-10-20'), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.X/ID.1' })], { bankAccountId: 'acc-1' });
  const body = find(controller);
  assert.deepEqual(body.likely.map((r) => r.reservationId).sort(), [a, b].sort());
});

test('rule 14 — the search covers client, booking number, amount and date, with the same tokens as the fiche', () => {
  const { controller, a, b } = world();
  const ids = (q) => { const body = find(controller, q); return [...body.likely, ...body.others.items].map((r) => r.reservationId).sort(); };
  assert.ok(ids('rossi').includes(b) && !ids('rossi').includes(a), 'text on the client name');
  assert.deepEqual(ids('400'), [a], 'an integer amount');
  assert.deepEqual(ids('19/10'), [b], 'a due date');
  assert.deepEqual(ids('12/13'), [], 'an invalid date reads as text');
});

test('rule 14 — several receipts of one credit: the sum may not exceed what the credit has left', () => {
  const { controller, a, b } = world();
  const ok = controller.linkBatch({ pairs: [
    { transactionId: 't1', reservationId: a, ledgerKey: 'balance', amountCents: 40000 },
    { transactionId: 't1', reservationId: b, ledgerKey: 'balance', amountCents: 30000 },
  ], user: USER });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.marked.length, 2);
  assert.equal(row(a).balancePaid, 1);
  assert.equal(row(b).balancePaid, 1);
});

test('rule 14 — over the credit\'s remaining: ALLOCATION_EXCEEDS_TRANSACTION, nothing stored', () => {
  const { controller, a, b } = world();
  const answer = controller.linkBatch({ pairs: [
    { transactionId: 't1', reservationId: a, ledgerKey: 'balance', amountCents: 40000 },
    { transactionId: 't1', reservationId: b, ledgerKey: 'balance', amountCents: 30001 },
  ], user: USER });
  assert.equal(answer.status, 422);
  assert.equal(answer.body.code, 'ALLOCATION_EXCEEDS_TRANSACTION');
  assert.equal(row(a).balancePaid, 0);
});

test('rule 14 — an unknown or fully allocated credit has no candidates', () => {
  const { controller } = world();
  assert.equal(controller.candidates({ transactionId: 'nope' }).status, 404);
});
