// specs/qonto-bank-reconciliation.md rule 46 (audit 2026-10-27) — a payout is matched to the stays of its
// platform whatever the stored spelling of the platform name: the boot de-duplication of platform rows
// may keep `Gitesdefrance` or `AirBnb`, and an exact-name match then proposed nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProposals } = require('../reconciliation/matcher');

const receipt = (platform, over = {}) => ({
  reservationId: 1, ledgerKey: 'balance', label: 'Solde', channel: `platform:${platform}`, platform,
  expectedCents: 45000, grossCents: 45000, openCents: 45000, payoutRecorded: true, paid: false,
  expectedDate: '2026-06-10', dueDate: '2026-06-10', paidDate: null,
  reservation: { id: 1, lastName: 'Dupont', reservationNumber: '', createdAt: '2026-01-01' }, ...over,
});
const credit = (over = {}) => ({
  id: 't1', amountCents: 45000, remainingCents: 45000, currency: 'EUR', settledAt: '2026-06-12T08:00:00.000Z',
  counterpartyName: '', label: '', reference: '', note: '', operationType: '', ...over,
});
const proposalFor = (receipts, tx) => buildProposals({ transactions: [tx], receipts }).byTransaction.t1.proposal;

test('a GdF payout finds a stay stored under a drifted spelling', () => {
  const p = proposalFor([receipt('Gitesdefrance')], credit({ counterpartyName: 'GITES DE FRANCE ARDECHE' }));
  assert.ok(p, 'proposed');
  assert.equal(p.allocations[0].reservationId, 1);
});

test('an Airbnb payout finds a stay stored as `AirBnb`', () => {
  assert.ok(proposalFor([receipt('AirBnb')], credit({ counterpartyName: 'AIRBNB PAYMENTS' })));
});

test('the batch platforms are recognised whatever their spelling', () => {
  const p = proposalFor([receipt('lodgify', { paidDate: '2026-06-10', expectedCents: 45000, openCents: 45000 })],
    credit({ counterpartyName: 'STRIPE', reference: 'STRIPE' }));
  assert.ok(p, 'the Stripe batch still proposes the lodgify stay');
});
