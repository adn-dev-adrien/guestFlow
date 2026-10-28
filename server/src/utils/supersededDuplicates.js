/**
 * Sets aside the stays the removed « platform disabled » display filter used to hide AND that are the
 * copy of a visible stay (specs/calendar-property-parity.md rules 22-24).
 *
 * The filter (specs/platforms-and-ical-rework.md rule 10) hid, from a logement's calendar only, every
 * stay whose platform had an `ical_sources` row with `disabled = 1` for that logement. Removing it makes
 * those stays visible again — which is right for the isolated ones (real past stays) and wrong for a
 * duplicate that sits on another stay. A hidden stay is a duplicate only when a visible stay of the same
 * logement overlaps its nights: nothing else can prove it is the copy. A candidate carrying money is never
 * touched. Pure SQL on the database it is given, so it runs at boot (before any read) and in tests.
 */

const REASON = 'disabled-source-duplicate';

// Exactly the old SQL: the platform matches a disabled source of the same logement, by label or key.
const HIDDEN_BY_OLD_FILTER = `
  EXISTS (
    SELECT 1 FROM ical_sources s
     WHERE s.propertyId = r.propertyId AND s.disabled = 1
       AND (lower(s.platformLabel) = lower(r.platform) OR lower(s.platformKey) = lower(r.platform))
  )`;

const CARRIES_MONEY = `
  (COALESCE(r.depositPaid, 0) = 1 OR COALESCE(r.balancePaid, 0) = 1
   OR COALESCE(r.complementPaid, 0) = 1 OR COALESCE(r.endOfStayComplementPaid, 0) = 1
   OR EXISTS (SELECT 1 FROM reservation_installments i WHERE i.reservationId = r.id AND i.paid = 1)
   OR EXISTS (SELECT 1 FROM payment_links l WHERE l.reservationId = r.id AND (l.status = 'paid' OR l.paidAt IS NOT NULL)))`;

/**
 * @returns {{ superseded: Array<{id:number, byReservationId:number}>, skippedPaid: number[], keptVisible: number[] }}
 */
function findCandidates(db) {
  const hidden = db.prepare(`
    SELECT r.id, r.propertyId, r.startDate, r.endDate, ${CARRIES_MONEY} AS carriesMoney
      FROM reservations r
     WHERE r.kind = 'reservation' AND ${HIDDEN_BY_OLD_FILTER}
     ORDER BY r.id
  `).all();
  const earliestVisibleOverlap = db.prepare(`
    SELECT r.id FROM reservations r
     WHERE r.kind = 'reservation' AND r.propertyId = ? AND r.id != ? AND NOT ${HIDDEN_BY_OLD_FILTER}
       AND r.startDate < ? AND r.endDate > ?
     ORDER BY r.startDate, r.id
     LIMIT 1
  `);

  const result = { superseded: [], skippedPaid: [], keptVisible: [] };
  for (const stay of hidden) {
    const keeper = earliestVisibleOverlap.get(stay.propertyId, stay.id, stay.endDate, stay.startDate);
    if (!keeper) result.keptVisible.push(stay.id);
    else if (Number(stay.carriesMoney) === 1) result.skippedPaid.push(stay.id);
    else result.superseded.push({ id: stay.id, byReservationId: keeper.id });
  }
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
    { field: 'supersededReason', label: 'Motif', fromText: null, toText: REASON },
    { field: 'actor', label: 'Auteur', fromText: null, toText: 'migration' },
  ];
}

/**
 * Sets the candidates aside, each with its audit entry, in one transaction. Returns the counts and ids
 * the boot log prints.
 */
function setAsideDuplicates(db) {
  const found = findCandidates(db);
  const mark = db.prepare(`
    UPDATE reservations
       SET kind = 'superseded', supersededAt = datetime('now'), supersededByReservationId = ?, supersededReason = ?,
           updatedAt = datetime('now')
     WHERE id = ? AND kind = 'reservation'
  `);
  const audit = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const { id, byReservationId } of found.superseded) {
      mark.run(byReservationId, REASON, id);
      audit.run(id, 'superseded', JSON.stringify(supersededHistory(db, byReservationId)));
    }
  })();
  return found;
}

module.exports = { REASON, findCandidates, setAsideDuplicates };
