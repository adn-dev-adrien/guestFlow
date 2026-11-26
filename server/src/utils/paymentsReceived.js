/**
 * Reads of the online payments recorded on a stay, for the operator's notice and the home's « Paiements reçus » subject
 * (specs/payments/online-payment-notices.md rules 1, 5, 7). The sentences are written by `utils/paymentNotices.js`.
 *
 *   stayOfLink(database, link)           → the stay row (a devis link follows its devis to the stay it became), or null
 *   noticeOf(database, link)             → the operator's notice for a paid link, or null when no stay holds it
 *   listReceived(database)               → the last 24 hours' lines of the home subject, most recent first
 *   closesTheBalance(database, link)     → true for a balance link, and for the last échéance of a schedule
 */

const { paymentNotice, receivedLine } = require('./paymentNotices');

const ANNOUNCED_TYPES = ['deposit', 'balance', 'full', 'installment'];

const STAY_SELECT = `
  SELECT r.id, r.kind, r.convertedReservationId, r.startDate, r.endDate, c.firstName, c.lastName, p.name AS propertyName
    FROM reservations r
    LEFT JOIN clients c    ON c.id = r.clientId
    LEFT JOIN properties p ON p.id = r.propertyId
   WHERE r.id = ?`;

function stayOfLink(database, link) {
  if (!link || link.saleRef || link.reservationId == null) return null;
  const own = database.prepare(STAY_SELECT).get(Number(link.reservationId));
  if (!own) return null;
  const stay = own.kind === 'devis' && own.convertedReservationId
    ? database.prepare(STAY_SELECT).get(Number(own.convertedReservationId)) : own;
  return stay && stay.kind === 'reservation' ? stay : null;
}

function noticeOf(database, link) {
  const stay = stayOfLink(database, link);
  return stay ? { stay, notice: paymentNotice({ type: link.type, amountCents: link.amountCents, stay }) } : null;
}

function listReceived(database) {
  const links = database.prepare(`
    SELECT id, reservationId, type, amountCents, paidAt FROM payment_links
     WHERE status = 'paid' AND type IN (${ANNOUNCED_TYPES.map(() => '?').join(', ')})
       AND paidAt IS NOT NULL AND datetime(paidAt) > datetime('now', '-24 hours')
     ORDER BY datetime(paidAt) DESC, id DESC`).all(...ANNOUNCED_TYPES);
  return links.flatMap((link) => {
    const stay = stayOfLink(database, link);
    return stay ? [receivedLine({ type: link.type, amountCents: link.amountCents, stay, paidAt: link.paidAt })] : [];
  });
}

function closesTheBalance(database, link) {
  if (link.type === 'balance') return true;
  if (link.type !== 'installment') return false;
  const open = database.prepare('SELECT COUNT(*) AS n FROM reservation_installments WHERE reservationId = ? AND paid = 0').get(Number(link.reservationId));
  return Number(open.n) === 0;
}

module.exports = { ANNOUNCED_TYPES, stayOfLink, noticeOf, listReceived, closesTheBalance };
