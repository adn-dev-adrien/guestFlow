// specs/qonto-bank-reconciliation.md rule 44 (audit 2026-10-27, finding 8) — a platform that took an
// acompte pays it out on its own: the later solde credit carries the solde only. Writing that credit as
// the stay's whole payout inflated the commission by the acompte: brut 1000, acompte 300 (commission
// 15), solde credit 665 → the fiche stored a 320 € commission instead of 35 €.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { platformAcompteNet } = require('../reconciliation/expectedReceipts');

test.beforeEach(() => { reset(); });

db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('GitesDeFrance')").run();

const stay = (over = {}) => addReservation({
  platform: 'GitesDeFrance', finalPrice: 1000, platformGrossAmount: 1000,
  depositAmount: 300, depositPaid: 1, depositPaidDate: '2026-09-01', acompteCommissionAmount: 15,
  balanceAmount: 700, balanceDueDate: '2026-11-01', ...over,
});

test('rule 44 — the acompte already paid out is the acompte net of its commission', () => {
  assert.equal(platformAcompteNet({ depositAmount: 300, acompteCommissionAmount: 15 }), 285);
  assert.equal(platformAcompteNet({ depositAmount: 0, acompteCommissionAmount: 0 }), 0, 'no acompte, nothing');
  assert.equal(platformAcompteNet({ depositAmount: 300, depositDisabled: 1 }), 0);
});

test('rule 44 — confirming the 665 € solde credit stores payout 950 and commission 35, not 320', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 66500, { counterpartyName: 'GITES DE FRANCE' })], { bankAccountId: 'acc-1' });
  const answer = controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 66500 }], user: USER });
  assert.equal(answer.status, 201);
  const fiche = row(id);
  assert.equal(fiche.balancePaid, 1);
  assert.equal(fiche.platformPayoutAmount, 950, 'the whole stay net: 665 + (300 − 15)');
  assert.equal(fiche.platformCommissionAmount, 35);
});

test('rule 44 — with the payout on the fiche, the solde credit expected is the payout minus the acompte net', () => {
  const id = stay({ platformPayoutAmount: 950, platformCommissionAmount: 35 });
  const { controller } = build();
  const line = controller.compute().items.find((i) => i.reservation.id === id && i.ledgerKey === 'balance');
  assert.equal(line.expectedCents, 66500);
});
