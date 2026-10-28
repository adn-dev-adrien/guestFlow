// specs/reconciliation-assisted-matching.md rules 24, 31 — a platform credit below the expected payout offers
// « Déclarer une pénalité » with the gap; once declared, the expected bank amount is net of the penalties,
// the gap clears with no further step, and a confirmation writes payout = credit + acompte net + penalties.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { buildController } = require('../../../controllers/platformPenaltiesController');

const penalties = buildController({
  database: db, penaltiesModel: require('../../../models/platformPenaltiesModel'),
  reservationsModel: require('../../../models/reservationsModel'), todayOf: () => '2026-10-23',
});

test.beforeEach(() => { reset(); db.prepare('DELETE FROM reservation_platform_penalties').run(); });

const at = (day) => `${day}T09:00:00.000Z`;
const stay = (over = {}) => addReservation({
  platform: 'Booking', platformGrossAmount: 800, platformPayoutAmount: 610.02, platformCommissionAmount: 189.98,
  finalPrice: 800, balanceAmount: 800, depositAmount: 0, balanceDueDate: '2026-10-10', ...over,
});
const received = (over = {}) => stay({ balancePaid: 1, balancePaidDate: '2026-10-12', ...over });
const payout = (id, cents) => credit(id, cents, { settledAt: at('2026-10-12'), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' });
const itemOf = (controller, id) => ['todo', 'done'].flatMap((view) => controller.list({ view }).body.items).find((i) => i.reservation.id === id);

test('rule 24 — a credit below the expected payout offers « Déclarer une pénalité » prefilled with the gap', () => {
  const id = received();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 57002)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 57002 }], user: USER });
  const item = itemOf(controller, id);
  assert.equal(item.state, 'amount_gap');
  assert.deepEqual(item.declarePenalty, { amountCents: 4000, amount: 40 });
});

test('rule 24 — a credit above the payout, or a direct stay, offers none', () => {
  const id = received();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 65002)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 65002 }], user: USER });
  assert.equal(itemOf(controller, id).declarePenalty, null);
});

test('rule 31 — once declared, the gap clears on the next load with no further step', () => {
  const id = received();
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 57002)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 57002 }], user: USER });
  const declared = penalties.declare(id, { amount: 40, reason: 'Frais de relogement', date: '2026-10-12', source: 'reconciliation' }, USER);
  assert.equal(declared.status, 201);
  const item = itemOf(controller, id);
  assert.equal(item.expectedCents, 57002, 'the expected bank amount is net of the penalty');
  assert.equal(item.state, 'reconciled');
  assert.equal(item.declarePenalty, null);
});

test('rule 31 — a proposal matches the credit net of the penalty and the confirmation writes payout = credit + penalties', () => {
  const id = stay();
  penalties.declare(id, { amount: 40, reason: 'Frais de relogement', date: '2026-10-05', source: 'reconciliation' }, USER);
  db.prepare('UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL WHERE id = ?').run(id);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 57002)], { bankAccountId: 'acc-1' });
  const proposal = controller.list({ view: 'todo' }).body.items.find((i) => i.reservation.id === id).proposal;
  assert.equal(proposal.confidence, 'sur');
  controller.confirm({ transactionId: 'p', allocations: proposal.allocations, user: USER });
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).platformPayoutAmount, 610.02, 'the statement figure, not the bank amount');
});

test('rule 31 — with an acompte already paid out, the written payout adds its net and the penalties', () => {
  const id = stay({
    depositAmount: 300, acompteCommissionAmount: 15, platformGrossAmount: 1000, finalPrice: 1000, balanceAmount: 700,
    platformPayoutAmount: null, platformCommissionAmount: null,
  });
  penalties.declare(id, { amount: 40, reason: 'Non-conformité', date: '2026-10-05', source: 'fiche' }, USER);
  const { controller, transactions } = build();
  transactions.upsertMany([payout('p', 62500)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'p', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 62500 }], user: USER });
  assert.equal(row(id).platformPayoutAmount, 625 + 285 + 40);
});
