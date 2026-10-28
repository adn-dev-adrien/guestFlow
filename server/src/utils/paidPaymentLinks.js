/**
 * Paid online payments left without a stay: `payment_links` carries no foreign key, so a stay deleted
 * before the delete guard (specs/plugins-phase-3a-online-payment.md rule 27) left its money record
 * behind. A link retired after the guest paid it keeps its `paidAt` (rule 8), so it counts too.
 */
function countOrphanPaidLinks(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_links'").get()) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM payment_links l
     WHERE (l.status = 'paid' OR l.paidAt IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = l.reservationId)
  `).get().n;
}

module.exports = { countOrphanPaidLinks };
