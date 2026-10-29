// specs/qonto-bank-reconciliation.md rule 47 (audit R4 Q2): a stay paid through the payment link of the devis it
// came from is expected as a LINK receipt, not as a direct transfer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { db, TODAY, addReservation, reset } = require('./reconciliationFixture');
const { expectedReceiptsOfReservation } = require('../reconciliation/expectedReceipts');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const paymentLinks = require('../../../models/paymentLinksModel');

test.beforeEach(() => { reset(); });

test('rule 47: the receipt of a stay paid by its devis link is a link receipt', () => {
  const devis = addReservation({ kind: 'devis', finalPrice: 463.12, balanceAmount: 463.12 });
  const stay = addReservation({ finalPrice: 463.12, balanceAmount: 463.12, balancePaid: 1, balancePaidDate: '2026-10-12' });
  db.prepare('UPDATE reservations SET convertedReservationId = ? WHERE id = ?').run(stay, devis);
  const link = paymentLinks.create({ reservationId: devis, type: 'full', amountCents: 46312, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  paymentLinks.markPaid(link.id, { providerPaymentId: 'p', paidAt: '2026-10-12T08:00:00Z' });
  const receipts = expectedReceiptsOfReservation({
    db, reservationId: stay, startDate: '2026-10-01', today: TODAY, buildLedger, parseGroup,
    listLinks: (id) => paymentLinks.listForStay(id), listInstallments: () => [],
  });
  const balance = receipts.find((r) => r.ledgerKey === 'balance');
  assert.equal(balance.channel, 'link');
  assert.equal(balance.linkPaidAt, '2026-10-12');
});

test('rule 47: the plugin reads the links of the stay and of the devis it came from', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'reconciliation', 'index.js'), 'utf8');
  assert.match(source, /listLinks: \(id\) => \{ try \{ return links\.listForStay\(id\)/);
  assert.doesNotMatch(source, /links\.listForReservation/);
});
