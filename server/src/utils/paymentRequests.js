/**
 * What the emails controller knows of the stay's own payment links (specs/payment-link-lifecycle.md
 * rules 26, 35): whether a link can be minted, and the link a request or the acompte reminder carries,
 * resolved at send time like the fiche's « Envoyer la demande » (reused with 24 h left, else minted).
 * The installment counterpart is utils/installmentRequests.js. Every dependency is injectable.
 *
 *   available()                  → a connected payment provider can mint links
 *   ensureLink(reservationId, type) → { url, expiresAt, … }; throws { httpStatus, error, message }
 */

function createPaymentRequests({
  paymentProviders = require('./paymentProviders'),
  ensureLink = (reservationId, type) => require('../controllers/paymentsController').ensurePaymentLinkFor(reservationId, type),
} = {}) {
  return {
    available: () => Boolean(paymentProviders.active()),
    ensureLink,
  };
}

module.exports = { createPaymentRequests };
