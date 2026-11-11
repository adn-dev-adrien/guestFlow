/**
 * « Retirer le lien » — the operator withdraws an open payment link by hand
 * (specs/payment-link-lifecycle.md rule 42).
 *
 *   withdrawPaymentLink(linkId, { database, paymentLinksModel, provider, bookPaid, now? }) → { link }
 *
 * The link is withdrawn (`cancelled`, reason `operator`, its end stamped now for the ledger's « Lien retiré
 * le … ») and deactivated at the provider, the marker kept when that fails. A provider that is not
 * connected (`isReady()` false) cannot be read: the link is withdrawn with the marker, and the poll reads its
 * payment before deactivating it (plugins-phase-3a rule 8). Refused: 404 for an unknown
 * link, 409 `LINK_ALREADY_PAID` when the guest has just paid (read once at the provider; the payment of that
 * read is booked at once through `bookPaid(link, payment)`, the poll's path, so the fiche shows it; a link a
 * webhook already flipped to `paid` is already booked), 409
 * `STAY_READ_ONLY` on a cancelled stay or a duplicate set aside. A link already withdrawn or lapsed is
 * answered as it is: a second click changes nothing. Throws `{ httpStatus, error, message }`.
 */

const { retireOpenLink } = require('./paymentLinkDeactivation');
const { LINK_REASONS } = require('../constants/paymentLinks');

const READ_ONLY_KINDS = new Set(['cancelled', 'superseded']);
const ALREADY_PAID = { httpStatus: 409, error: 'LINK_ALREADY_PAID', message: 'Ce lien vient d’être payé : paiement enregistré.' };

// The stay that answers for the link: the reservation a converted devis became, else the row itself.
function stayKindOf(database, reservationId) {
  const row = database.prepare('SELECT kind, convertedReservationId FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row) return null;
  if (row.convertedReservationId) {
    const stay = database.prepare('SELECT kind FROM reservations WHERE id = ?').get(Number(row.convertedReservationId));
    if (stay) return stay.kind;
  }
  return row.kind;
}

function connected(provider) {
  try { return Boolean(provider && provider.isReady()); } catch { return false; }
}

async function withdrawPaymentLink(linkId, { database, paymentLinksModel, provider: declared, bookPaid, now = new Date(), deactivate = null }) {
  const provider = connected(declared) ? declared : null;
  const link = paymentLinksModel.findById(Number(linkId));
  if (!link) throw { httpStatus: 404, error: 'LINK_NOT_FOUND', message: 'Lien de paiement introuvable.' };
  if (READ_ONLY_KINDS.has(stayKindOf(database, link.reservationId))) {
    throw { httpStatus: 409, error: 'STAY_READ_ONLY', message: 'Séjour en lecture seule : lien non modifiable.' };
  }
  if (link.status === 'paid') throw ALREADY_PAID;
  if (link.status !== 'open') return { link };
  try {
    await retireOpenLink(link, { paymentLinksModel, provider, reason: LINK_REASONS.OPERATOR, now, deactivate });
  } catch (err) {
    if (err && err.error === 'LINK_ALREADY_PAID') {
      if (err.payment) await bookPaid(paymentLinksModel.findById(link.id) || link, err.payment);
      throw ALREADY_PAID;
    }
    throw err;
  }
  return { link: paymentLinksModel.findById(link.id) };
}

module.exports = { withdrawPaymentLink, stayKindOf, READ_ONLY_KINDS };
