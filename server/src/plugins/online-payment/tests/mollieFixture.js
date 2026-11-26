// Shared fixture of the Mollie suites (specs/payments/mollie-rolling-reserve-and-incoming-payments.md): a stay paid by a Qonto
// payment link, and the credits Mollie sends. Fictional data only.
const { db, TODAY, dayAt, addReservation, credit, build, reset } = require('./reconciliationFixture');
const paymentLinks = require('../../../models/paymentLinksModel');

/** A stay whose balance was paid by a payment link `daysAgo` days ago (a whole-day instant, Paris noon). */
function paidStay({ cents, daysAgo, type = 'balance', providerPaymentId = null, providerLinkId = null, clientId = 1, stay = {} }) {
  const paidDay = dayAt(-daysAgo);
  const reservationId = addReservation({
    startDate: dayAt(-daysAgo - 10), endDate: dayAt(-daysAgo - 5), clientId,
    finalPrice: cents / 100, balanceAmount: cents / 100, balancePaid: 1, balancePaidDate: paidDay, ...stay,
  });
  const link = paymentLinks.create({
    reservationId, type, amountCents: cents, provider: 'qonto', providerLinkId: providerLinkId || `L${reservationId}`, url: 'u', status: 'open',
  });
  paymentLinks.markPaid(link.id, { providerPaymentId: providerPaymentId || `pay-${reservationId}`, paidAt: `${paidDay}T10:00:00Z` });
  return { reservationId, link: paymentLinks.findById(link.id), paidDay };
}

/** A credit from Mollie, `daysAgo` days ago, with the settlement reference Qonto shows. */
function mollieCredit(id, cents, daysAgo, { reference = `REF T19274230.2611.0${String(id).length}`, ...over } = {}) {
  return credit(id, cents, {
    settledAt: `${dayAt(-daysAgo)}T08:00:00.000Z`, operationType: 'Transférer', label: 'Stichting Mollie Payments',
    counterpartyName: 'Stichting Mollie Payments', reference, ...over,
  });
}

module.exports = { db, TODAY, dayAt, build, reset, paidStay, mollieCredit, addReservation };
