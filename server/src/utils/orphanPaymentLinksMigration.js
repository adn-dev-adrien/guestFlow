/**
 * One-shot withdrawal of the open orphan payment links (specs/payment-link-lifecycle.md rule 5).
 *
 * Links of stays deleted before the delete guard existed are still `open`, hence payable at the
 * provider. Each one becomes `cancelled` / `orphan`; one with a provider id gets the deactivation
 * marker, so the first poll pass reads its payment and deactivates it (plugins-phase-3a rule 8), or
 * alerts when it was paid meanwhile (rule 4). No network call: database.js is synchronous.
 * Paid, cancelled and expired rows are never touched. Idempotent via `migrations`.
 */

const { LINK_REASONS } = require('../constants/paymentLinks');

const MIGRATION_NAME = 'orphan_payment_links_withdrawn_v1';

const euros = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;

function runOrphanPaymentLinksMigration(database, { now = new Date(), logger = console } = {}) {
  if (database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME)) return { ran: false, withdrawn: [] };
  const at = now.toISOString();
  const withdrawn = database.transaction(() => {
    const orphans = database.prepare(`
      SELECT l.* FROM payment_links l
       WHERE l.status = 'open' AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = l.reservationId)
       ORDER BY l.id
    `).all();
    const withdraw = database.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = ?, remoteCancelPendingAt = ? WHERE id = ? AND status = 'open'");
    const done = [];
    for (const link of orphans) {
      const pending = link.providerLinkId ? at : null;
      if (Number(withdraw.run(LINK_REASONS.ORPHAN, pending, link.id).changes) > 0) {
        done.push({ ...link, status: 'cancelled', cancelReason: LINK_REASONS.ORPHAN, remoteCancelPendingAt: pending });
      }
    }
    database.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION_NAME);
    return done;
  })();
  for (const link of withdrawn) {
    const outcome = link.remoteCancelPendingAt ? `deactivation owed at ${link.provider}` : 'no provider link to deactivate';
    logger.log(`[migration:orphan-links] link #${link.id} (${link.type}, ${euros(link.amountCents)}, former stay ${link.reservationId}) withdrawn: ${outcome}`);
  }
  return { ran: true, withdrawn };
}

module.exports = { runOrphanPaymentLinksMigration, MIGRATION_NAME };
