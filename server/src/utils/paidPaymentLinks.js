/**
 * Paid online payments as a reason to keep a stay (specs/online-payments-qonto.md §5): a link the guest
 * paid is a money record, and `payment_links` carries no foreign key to the stay. A link retired after the
 * guest paid it keeps its `paidAt` (specs/plugins-phase-3a-online-payment.md rule 8), so it counts too.
 * Both reads tolerate a schema without the table.
 */
const PAID = "(status = 'paid' OR paidAt IS NOT NULL)";

const hasTable = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_links'").get());

function hasPaidLink(db, reservationId) {
  if (!hasTable(db)) return false;
  return Boolean(db.prepare(`SELECT 1 FROM payment_links WHERE reservationId = ? AND ${PAID} LIMIT 1`).get(Number(reservationId)));
}

function countOrphanPaidLinks(db) {
  if (!hasTable(db)) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM payment_links l
     WHERE (l.status = 'paid' OR l.paidAt IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = l.reservationId)
  `).get().n;
}

module.exports = { hasPaidLink, countOrphanPaidLinks };
