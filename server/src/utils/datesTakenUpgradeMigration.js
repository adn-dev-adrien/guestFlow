/**
 * One-shot withdrawal of the links whose dates were already taken at the upgrade (specs/payment-link-lifecycle.md
 * rules 10, 31, 37; decision (a) of the implementation plan, Adrien 2026-10-30).
 *
 * Before this version a stay holding its nights never withdrew anyone's link: an unpaid devis or reservation
 * overlapped since then still holds a payable link. At the first boot each of them is withdrawn (`dates-taken`,
 * the deactivation owed, so the first poll pass reads its payment then deactivates it, rule 33 when it was paid),
 * and its stay gets one `dates_taken_notices` row `not-sent` / `upgrade`: the dashboard lists it as « client non
 * prévenu », and no guest e-mail is ever sent for it (the notice of rule 43 claims a stay's row before sending,
 * and finds this one taken). No network call: database.js is synchronous. Idempotent via `migrations`.
 */

const MIGRATION_NAME = 'dates_taken_links_withdrawn_v1';

const euros = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;

function runDatesTakenUpgradeMigration(database, { now = new Date(), logger = console } = {}) {
  if (database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME)) return { ran: false, withdrawn: [], seeded: 0 };
  const { withdrawLinksOverlapping } = require('./paymentLinkLifecycle');
  const seed = database.prepare(`
    INSERT INTO dates_taken_notices (reservationId, takenByReservationId, noticeStatus, noticeReason, createdAt)
    VALUES (?, ?, 'not-sent', 'upgrade', ?)
    ON CONFLICT(reservationId) DO NOTHING
  `);
  const { withdrawn, seeded } = database.transaction(() => {
    const links = withdrawLinksOverlapping(database, { now });
    let count = 0;
    for (const link of links) count += Number(seed.run(link.stayId, link.takenByReservationId, now.toISOString()).changes);
    database.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION_NAME);
    return { withdrawn: links, seeded: count };
  })();
  for (const link of withdrawn) {
    const outcome = link.remoteCancelPendingAt ? `deactivation owed at ${link.provider}` : 'no provider link to deactivate';
    logger.log(`[migration:dates-taken-links] link #${link.id} (${link.type}, ${euros(link.amountCents)}, stay ${link.stayId}) withdrawn: dates taken by stay ${link.takenByReservationId}; ${outcome}`);
  }
  logger.log(`[migration:dates-taken-links] ${withdrawn.length} link(s) withdrawn, ${seeded} notice row(s) seeded (not-sent, upgrade)`);
  return { ran: true, withdrawn, seeded };
}

module.exports = { runDatesTakenUpgradeMigration, MIGRATION_NAME };
