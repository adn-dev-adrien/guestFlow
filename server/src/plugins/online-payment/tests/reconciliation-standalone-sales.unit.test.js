// specs/resource-booking-pricing-and-invoicing.md rule 20 — the card sales made outside any stay sit in the day's on-site
// card batch: counted first, named in the reason, never written on a fiche.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProposals } = require('../reconciliation/matcher');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const paid = (id, cents) => ({
  reservationId: id, ledgerKey: 'balance', label: 'Solde', channel: 'direct', platform: 'direct',
  expectedCents: cents, grossCents: cents, openCents: cents, payoutRecorded: true, paid: true,
  expectedDate: `${Y}-11-09`, dueDate: `${Y}-11-09`, paidDate: `${Y}-11-09`, reservation: { id, lastName: 'Dupont', createdAt: `${Y}-01-01` },
});
const batch = (cents) => ({
  id: 't1', amountCents: cents, remainingCents: cents, currency: 'EUR', settledAt: `${Y}-11-09T18:00:00.000Z`,
  counterpartyName: 'Paiements facturés', label: '', reference: `Paiements-En-Personne-09-11-${Y}`, note: '', operationType: '',
});
const bath = (cardCents, date = `${Y}-11-09`) => ({ key: `resource-booking:${cardCents}`, date, cardCents, totalCents: cardCents, booksCents: cardCents });

test('rule 20 — the day\'s outside sales are counted before the fiches, and the reason names them', () => {
  // 170 € credited: a stay paid 100 € by card, two baths 50 € + 20 €.
  const out = buildProposals({ transactions: [batch(17000)], receipts: [paid(1, 10000)], standalone: [bath(5000), bath(2000)] }).byTransaction.t1;
  assert.equal(out.proposal.allocations.length, 1);
  assert.equal(out.proposal.allocations[0].amountCents, 10000);
  assert.equal(out.proposal.reason, 'Paiements par carte sur place du jour, dont 2 ventes hors séjour (70,00 €)');
  assert.deepEqual(out.proposal.standalone, { count: 2, cents: 7000 });
});

test('rule 20 — a stay that no longer fits beside the outside sales is not proposed', () => {
  const out = buildProposals({ transactions: [batch(12000)], receipts: [paid(1, 10000)], standalone: [bath(5000)] }).byTransaction.t1;
  assert.equal(out.proposal, null);
});

test('rule 20 — outside sales of another day, or paid without a card, change nothing', () => {
  const out = buildProposals({ transactions: [batch(10000)], receipts: [paid(1, 10000)], standalone: [bath(5000, `${Y}-11-08`), { ...bath(0), cardCents: 0 }] }).byTransaction.t1;
  assert.equal(out.proposal.allocations.length, 1);
  assert.equal(out.proposal.reason, 'Paiements par carte sur place du jour');
});
