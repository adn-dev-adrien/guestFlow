/**
 * The open payment links of a stay — and of the devis converted into it, whose links keep the devis id —
 * that bill an amount the stay no longer asks for are retired with the reason `'amount-changed'` and the
 * remote-deactivation marker, exactly as the fiche's save does (specs/reservation-payment-ledger.md
 * rule 29, specs/public-online-payment.md rule 16). A paid link is never touched.
 *
 * Used when a devis converts and by the boot migration; synchronous, no provider call — the poll
 * deactivates the retired links at the provider and books any the guest paid anyway.
 */

const { withConvertedDevis } = require('./deletionGuard');
const { linkAmountCents } = require('./ledgerLinks');

function retireStaleLinksOfStay(database, stayId) {
  // A schema without the links table (older test fixtures) has nothing to retire.
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_links'").get()) return [];
  const stay = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(stayId));
  if (!stay || stay.kind !== 'reservation') return [];
  const owners = withConvertedDevis(database, [Number(stayId)]);
  const open = owners.flatMap((id) => database.prepare(
    "SELECT * FROM payment_links WHERE reservationId = ? AND status = 'open' AND type IN ('deposit', 'balance', 'full') ORDER BY id",
  ).all(id));
  const retire = database.prepare(
    "UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = ?, cancelReason = 'amount-changed' WHERE id = ? AND status = 'open'",
  );
  const at = new Date().toISOString();
  const retired = [];
  for (const link of open) {
    const expected = linkAmountCents(link.type, stay);
    if (expected == null || Number(link.amountCents) === expected) continue;
    const pending = link.providerLinkId ? at : null;
    if (Number(retire.run(pending, link.id).changes) > 0) {
      retired.push({ ...link, status: 'cancelled', remoteCancelPendingAt: pending, cancelReason: 'amount-changed' });
    }
  }
  return retired;
}

/** Boot migration body: every stay converted from a devis. Returns the retired links. */
function retireStaleLinksOfConvertedDevis(database) {
  const stays = database.prepare(`
    SELECT DISTINCT d.convertedReservationId AS id FROM reservations d
      JOIN payment_links l ON l.reservationId = d.id AND l.status = 'open'
     WHERE d.kind = 'devis' AND d.convertedReservationId IS NOT NULL
  `).all();
  return stays.flatMap((s) => retireStaleLinksOfStay(database, s.id));
}

module.exports = { retireStaleLinksOfStay, retireStaleLinksOfConvertedDevis };
