// specs/pricing-components.md §3 rule 70 — the reconciliation, the Gîtes de France intake and the ledger's commission detail read
// PLATFORM PAYMENT instead of their own arithmetic: the helpers they call return what the inline formulas returned.
const test = require('node:test');
const assert = require('node:assert/strict');
const platformPayment = require('../utils/pricing/platformPayment');
const platformCommission = require('../utils/platformCommission');
const sdk = require('../plugins/sdk');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const reconciliation = optionalPlugin(() => require('../plugins/online-payment/reconciliation/expectedReceipts'));

const round2 = (n) => Math.round(n * 100) / 100;
const AMOUNTS = [0, 0.1, 19.99, 100, 200.1, 400.2, 553.37, 1234.56];

test('rule 70 — rentOnly commission is the rent less the net rent, to the cent, as the intake always computed it', () => {
  for (const rent of AMOUNTS) {
    for (const netRent of AMOUNTS) {
      assert.equal(platformCommission.commissionOf({ basis: 'rentOnly', rent, netRent }), round2(rent - netRent));
    }
  }
  assert.equal(platformCommission.commissionOf({ basis: 'rentOnly', rent: 100, netRent: null }), null);
});

test('rule 70 — the SDK platformCommission keeps the statement basis and adds rentOnly', () => {
  const services = require('../plugins/sdk/coreServices');
  assert.equal(services.reservations.platformCommission({ gross: 300, payout: 250, touristTax: 10 }), 40);
  assert.equal(services.reservations.platformCommission({ basis: 'rentOnly', rent: 300, netRent: 255.5 }), 44.5);
});

test('rule 70 — gross and the acompte net are PLATFORM PAYMENT\'s, reached by the reconciliation through the SDK', { skip: skipWithout(['online-payment']) }, () => {
  const core = sdk.coreModule('platformPayment');
  assert.equal(core.acompteNet, platformPayment.acompteNet);
  assert.equal(core.grossOf, platformPayment.grossOf);
  assert.equal(core.payoutWithPenalty, platformPayment.payoutWithPenalty);
  assert.equal(reconciliation.platformAcompteNet, platformPayment.acompteNet);
});

test('rule 70 — the payout the fiche stores is the credit plus the acompte net plus the penalty kept, rounded once', () => {
  for (const got of [0, 1234, 55337, 20010]) {
    for (const penalty of [undefined, null, 0, 12.5, -3]) {
      const before = { depositAmount: 200.1, acompteCommissionAmount: 20.01, platformPenaltyAmount: penalty };
      const inline = round2(got / 100 + platformPayment.acompteNet(before) + Math.max(0, Number(penalty || 0)));
      assert.equal(platformPayment.payoutWithPenalty({ payout: got / 100 + platformPayment.acompteNet(before), penalty }), inline);
    }
  }
});

test('rule 70 — the ledger\'s acompte commission detail is the deposit less the commission', () => {
  for (const deposit of AMOUNTS) {
    for (const commission of AMOUNTS) assert.equal(platformPayment.netOfCommission({ amount: deposit, commission }), deposit - commission);
  }
});
