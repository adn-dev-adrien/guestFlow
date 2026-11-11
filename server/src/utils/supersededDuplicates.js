/**
 * Sets aside the stays the removed « platform disabled » display filter used to hide AND that are the
 * copy of a visible stay (specs/calendar-property-parity.md rules 22-24).
 *
 * The filter (specs/platforms-and-ical-rework.md rule 10) hid, from a logement's calendar only, every
 * stay whose platform had an `ical_sources` row with `disabled = 1` for that logement. Removing it makes
 * those stays visible again — which is right for the isolated ones (real past stays) and wrong for a
 * duplicate that sits on another stay. A hidden stay is a duplicate only when a visible stay of the same
 * logement overlaps its nights: nothing else can prove it is the copy. A candidate carrying money is never
 * touched, nor is one that is longer than its keeper (even by one night): both are flagged for the operator. Pure SQL on the
 * database it is given, so it runs at boot (before any read) and in tests.
 */

const REASON = 'disabled-source-duplicate';

// Exactly the old SQL: the platform matches a disabled source of the same logement, by label or key.
const HIDDEN_BY_OLD_FILTER = `
  EXISTS (
    SELECT 1 FROM ical_sources s
     WHERE s.propertyId = r.propertyId AND s.disabled = 1
       AND (lower(s.platformLabel) = lower(r.platform) OR lower(s.platformKey) = lower(r.platform))
  )`;

// specs/payment-link-lifecycle.md rule 31 — one reading of « carries money », shared with the held dates.
const { carriesMoneySql } = require('./stayMoney');
const { withdrawSupersededLinks } = require('./paymentLinkLifecycle');

/**
 * A hidden stay is the copy of a visible one only when its nights sit fully inside the keeper's: a stay
 * that starts earlier or ends later would free nights for sale once set aside (audit 2026-10-28, a copy
 * one night longer than its keeper used to be set aside).
 */
const sitsWithin = (stay, keeper) => stay.startDate >= keeper.startDate && stay.endDate <= keeper.endDate;

/**
 * @returns {{
 *   superseded: Array<{id:number, byReservationId:number}>,
 *   flagged: number[],      // stays left as they are but stamped `bookingConflictAt`: the conflict alert shows them
 *   keptVisible: number[],  // hidden stays that overlap nothing: they simply reappear
 *   conflicts: Array<{id:number, otherId:number, why:'paid'|'longer'|'hidden-overlap'}>,
 * }}
 */
function findCandidates(db) {
  const hidden = db.prepare(`
    SELECT r.id, r.propertyId, r.startDate, r.endDate, ${carriesMoneySql(db, 'r')} AS carriesMoney
      FROM reservations r
     WHERE r.kind = 'reservation' AND ${HIDDEN_BY_OLD_FILTER}
     ORDER BY r.id
  `).all();
  const earliestVisibleOverlap = db.prepare(`
    SELECT r.id, r.startDate, r.endDate FROM reservations r
     WHERE r.kind = 'reservation' AND r.propertyId = ? AND r.id != ? AND NOT ${HIDDEN_BY_OLD_FILTER}
       AND r.startDate < ? AND r.endDate > ?
     ORDER BY r.startDate, r.id
     LIMIT 1
  `);
  const hiddenOverlap = db.prepare(`
    SELECT r.id FROM reservations r
     WHERE r.kind = 'reservation' AND r.propertyId = ? AND r.id != ? AND ${HIDDEN_BY_OLD_FILTER}
       AND r.startDate < ? AND r.endDate > ?
     ORDER BY r.startDate, r.id
     LIMIT 1
  `);

  const result = { superseded: [], flagged: [], keptVisible: [], conflicts: [] };
  const conflict = (id, otherId, why) => result.conflicts.push({ id, otherId, why });
  for (const stay of hidden) {
    const keeper = earliestVisibleOverlap.get(stay.propertyId, stay.id, stay.endDate, stay.startDate);
    if (!keeper) {
      // Nothing visible proves it is a copy, but two hidden stays on the same nights would be a double
      // booking the moment they reappear.
      const other = hiddenOverlap.get(stay.propertyId, stay.id, stay.endDate, stay.startDate);
      if (other) conflict(stay.id, other.id, 'hidden-overlap');
      else result.keptVisible.push(stay.id);
    } else if (Number(stay.carriesMoney) === 1) conflict(stay.id, keeper.id, 'paid');
    else if (!sitsWithin(stay, keeper)) conflict(stay.id, keeper.id, 'longer');
    else result.superseded.push({ id: stay.id, byReservationId: keeper.id });
  }
  result.flagged = [...new Set(result.conflicts.flatMap((c) => [c.id, c.otherId]))].sort((a, b) => a - b);
  return result;
}

function numberOf(db, id) {
  const row = db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(id);
  return (row && row.reservationNumber) || `#${id}`;
}

/** The audit entry of a stay set aside (rule 24), as ready-to-print rows. */
function supersededHistory(db, byReservationId) {
  return [
    { field: 'kind', label: 'Statut', fromText: 'Réservation', toText: 'Doublon écarté' },
    { field: 'supersededByReservationId', label: 'Doublon de', fromText: null, toText: `Réservation ${numberOf(db, byReservationId)}` },
    { field: 'supersededReason', label: 'Motif', fromText: null, toText: "Copie d'un séjour visible" },
    { field: 'actor', label: 'Auteur', fromText: null, toText: 'migration' },
  ];
}

const CONFLICT_WHY = {
  paid: 'un paiement est enregistré sur la copie présumée',
  longer: 'les dates dépassent celles du séjour visible',
  'hidden-overlap': 'deux séjours masqués sur les mêmes nuits',
};

/**
 * Sets the true copies aside, each with its audit entry, and stamps the ambiguous cases with
 * `bookingConflictAt` so the existing conflict alert shows them — all in one transaction. The open payment
 * links of a copy set aside are withdrawn (specs/payment-link-lifecycle.md rule 12, `superseded`), their
 * deactivation owed to the poll. Returns what the boot log prints.
 */
function setAsideDuplicates(db) {
  const found = findCandidates(db);
  const mark = db.prepare(`
    UPDATE reservations
       SET kind = 'superseded', supersededAt = datetime('now'), supersededByReservationId = ?, supersededReason = ?,
           updatedAt = datetime('now')
     WHERE id = ? AND kind = 'reservation'
  `);
  const flag = db.prepare("UPDATE reservations SET bookingConflictAt = ? WHERE id = ? AND ifnull(bookingConflictAt, '') = ''");
  const audit = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const { id, byReservationId } of found.superseded) {
      if (mark.run(byReservationId, REASON, id).changes > 0) withdrawSupersededLinks(db, id);
      audit.run(id, 'superseded', JSON.stringify(supersededHistory(db, byReservationId)));
    }
    for (const { id, otherId, why } of found.conflicts) {
      for (const [stayId, otherStayId] of [[id, otherId], [otherId, id]]) {
        if (flag.run(now, stayId).changes === 0) continue;
        audit.run(stayId, 'update', JSON.stringify([{
          field: 'bookingConflictAt', label: 'Conflit de dates', fromText: null,
          toText: `Chevauche la réservation ${numberOf(db, otherStayId)} : ${CONFLICT_WHY[why]} (migration)`,
        }]));
      }
    }
  })();
  return found;
}

module.exports = { REASON, findCandidates, setAsideDuplicates };
