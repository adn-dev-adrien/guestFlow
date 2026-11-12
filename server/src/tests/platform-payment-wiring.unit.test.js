// specs/pricing-components.md §3 rules 3 and 70 — PLATFORM PAYMENT is wired: the penalties controller, the stored summary, the gross
// fallback of the payment mark and the Airbnb intake's payment block ask the unit instead of carrying the formulas.
const test = require('node:test');
const assert = require('node:assert/strict');
const unit = require('../utils/pricing/platformPayment');

test('rule 70 — statementRemainder is the commission before its floor; statementPayout is the payout a statement implies', () => {
  assert.equal(unit.statementRemainder({ gross: 1236.26, payout: 1028.44, tax: 28.86 }), 178.96);
  assert.equal(unit.statementRemainder({ gross: 100, payout: 120 }), -20, 'negative when the figures disagree');
  assert.equal(unit.statementPayout({ gross: 500, commission: 75, acompteCommission: 10, tax: 5 }), 410);
  assert.equal(unit.statementPayout({ gross: 500, commission: null }), 500);
});

test('rule 70 — bankReceived: the payout less the acompte paid out and the penalties; nothing without a payout', () => {
  assert.equal(unit.bankReceived({ payout: 410, acompteNet: 90, penalties: 20 }), 300);
  assert.equal(unit.bankReceived({ payout: null, acompteNet: 90 }), null);
  assert.equal(unit.totalCommission(10.1, 20.2), 30.3);
});

test('rule 70 — grossOf keeps the deposit + balance fallback, acompteNet the commission taken on the acompte', () => {
  assert.equal(unit.grossOf({ platformGrossAmount: '', depositAmount: 100, balanceAmount: 250.5 }), 350.5);
  assert.equal(unit.grossOf({ platformGrossAmount: 420, depositAmount: 100, balanceAmount: 250 }), 420);
  assert.equal(unit.acompteNet({ depositAmount: 100, acompteCommissionAmount: 15 }), 85);
  assert.equal(unit.acompteNet({ depositAmount: 100, depositDisabled: 1 }), 0);
});

test('rule 3 — SETTLEMENT.linkAllowed: a link is allowed on the operator\'s own channel only, a converted devis answering for both', () => {
  const { linkAllowed } = require('../utils/pricing/settlement');
  assert.equal(linkAllowed({ ownChannel: true }), null);
  assert.equal(linkAllowed({ ownChannel: true, convertedOwnChannel: true }), null);
  assert.deepEqual(linkAllowed({ ownChannel: false }), { httpStatus: 409, error: 'PLATFORM_RESERVATION', message: 'Réservation plateforme : aucun lien de paiement.' });
  assert.equal(linkAllowed({ ownChannel: true, convertedOwnChannel: false }).error, 'PLATFORM_RESERVATION');
});

test('rule 70 — netOfCommission: an échéance\'s amount less the commission and the penalty, in the order the settlement always did', () => {
  assert.equal(unit.netOfCommission({ amount: 600, commission: 90, penalty: 10 }), 500);
  assert.equal(unit.netOfCommission({ amount: '', commission: null }), 0);
  const { remainingToPay } = require('../utils/reservationSettlement');
  assert.equal(remainingToPay({ depositAmount: 100, acompteCommissionAmount: 15, balanceAmount: 300, platformCommissionAmount: 45 }), 340);
});
