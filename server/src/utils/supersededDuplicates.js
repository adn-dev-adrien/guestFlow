/**
 * Sets aside the stays the removed « platform disabled » display filter used to hide AND that are the
 * copy of a visible stay (specs/calendar-property-parity.md rules 22-24).
 *
 * The filter (specs/platforms-and-ical-rework.md rule 10) hid, from a logement's calendar only, every
 * stay whose platform had an `ical_sources` row with `disabled = 1` for that logement. Removing it makes
 * those stays visible again — which is right for the isolated ones (real past stays) and wrong for a
 * duplicate that sits on another stay. A hidden stay is a duplicate only when a visible stay of the same
 * logement overlaps its nights: nothing else can prove it is the copy. A candidate carrying money is never
 * touched, nor is one that is longer than its keeper: both are flagged for the operator. Pure SQL on the
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

const CARRIES_MONEY = `
  (COALESCE(r.depositPaid, 0) = 1 OR COALESCE(r.balancePaid, 0) = 1
   OR COALESCE(r.complementPaid, 0) = 1 OR COALESCE(r.endOfStayComplementPaid, 0) = 1
   OR EXISTS (SELECT 1 FROM reservation_installments i WHERE i.reservationId = r.id AND i.paid = 1)
   OR EXISTS (SELECT 1 FROM payment_links l WHERE l.reservationId = r.id AND (l.status = 'paid' OR l.paidAt IS NOT NULL)))`;

const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * A hidden stay is the copy of a visible one only when it sits within the keeper's dates, a day of slack
 * either side (a platform's departure day often differs by one): a longer stay would free nights for sale
 * once set aside.
 */
const sitsWithin = (stay, keeper) => stay.startDate >= addDays(keeper.startDate, -1) && stay.endDate <= addDays(keeper.endDate, 1);

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
    SELECT r.id, r.propertyId, r.startDate, r.endDate, ${CARRIES_MONEY} AS carriesMoney
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
 * `bookingConflictAt` so the existing conflict alert shows them — all in one transaction. Returns what
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
  const flag = db.prepare("UPDATE reservations SET bookingConflictAt = ? WHERE id = ? AND ifnull(bookingConflictAt, '') = ''");
  const audit = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const { id, byReservationId } of found.superseded) {
      mark.run(byReservationId, REASON, id);
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
