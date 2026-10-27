/**
 * One-shot repair of the arrival complement a stay lost at creation —
 * specs/force-item-to-complement.md rule 18 (spec review of 2026-10-27).
 *
 * `insertReservation` never wrote `complementAmount`: a stay created with a line routed to the
 * complement (« Ménage 80 € » on « Complément ») stored 0 while the engine had already taken the line
 * out of the acompte and the solde. The SAS then read « Rien à percevoir » and the money was never
 * asked for. The first save of the fiche re-prices the row and heals it, so only rows never saved
 * since their creation still carry the hole.
 *
 * Deliberately narrow — a row is repaired only when every one of these holds:
 *   - a reservation (not a devis), not cancelled, created on the fiche (`sourceType = 'manual'`);
 *   - its complement is unpaid, stored at 0, not adjusted by hand, and its arrival SAS is not done;
 *   - it has no `update` history entry (a save since creation already wrote the right amount);
 *   - the routed lines (not offered, `inComplement = 1`), plus the tourist tax when it is routed to the
 *     complement, add up to a positive amount that is EXACTLY what the row's own totals leave
 *     uncollected: `finalPrice − depositAmount − balanceAmount`. Any other gap (an installment plan, a
 *     platform brut, a hand-typed amount) is not this bug, and the row is left alone.
 *
 * Each repaired row gets a history entry, and the caller logs the list. Idempotent: a repaired row
 * no longer stores 0, so a second run matches nothing.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const CANDIDATES_SQL = `
  SELECT r.id, r.reservationNumber, r.finalPrice, r.depositAmount, r.balanceAmount,
         r.touristTaxTotal, r.touristTaxInComplement,
         (SELECT COALESCE(SUM(o.totalPrice), 0) FROM reservation_options o
           WHERE o.reservationId = r.id AND COALESCE(o.offered, 0) = 0 AND COALESCE(o.inComplement, 0) = 1) AS optionsTotal,
         (SELECT COALESCE(SUM(c.amount), 0) FROM reservation_custom_options c
           WHERE c.reservationId = r.id AND COALESCE(c.offered, 0) = 0 AND COALESCE(c.inComplement, 0) = 1) AS customTotal,
         (SELECT COALESCE(SUM(s.totalPrice), 0) FROM reservation_resources s
           WHERE s.reservationId = r.id AND COALESCE(s.offered, 0) = 0 AND COALESCE(s.inComplement, 0) = 1) AS resourcesTotal
    FROM reservations r
   WHERE COALESCE(r.kind, 'reservation') = 'reservation'
     AND r.cancelledAt IS NULL
     AND COALESCE(r.sourceType, 'manual') = 'manual'
     AND COALESCE(r.complementPaid, 0) = 0
     AND COALESCE(r.complementAmount, 0) = 0
     AND r.complementAmountOverride IS NULL
     AND r.arrivalSasDoneAt IS NULL
     AND NOT EXISTS (SELECT 1 FROM reservation_history h WHERE h.reservationId = r.id AND h.eventType = 'update')
`;

function hasColumns(db, table, names) {
  try {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    return names.every((n) => cols.has(n));
  } catch {
    return false;
  }
}

function runCreatedComplementRepair(db) {
  const needed = ['complementAmount', 'complementAmountOverride', 'arrivalSasDoneAt', 'cancelledAt', 'kind', 'reservationNumber'];
  // A schema still missing a column (a baseline replayed later in the boot) is not repaired yet: null
  // tells the caller not to record the migration, so the next boot runs it.
  if (!hasColumns(db, 'reservations', needed)) return null;
  const repaired = [];
  const write = db.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ? AND COALESCE(complementAmount, 0) = 0");
  const history = db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)");
  for (const row of db.prepare(CANDIDATES_SQL).all()) {
    const tax = Number(row.touristTaxInComplement || 0) === 1 ? Number(row.touristTaxTotal || 0) : 0;
    const routed = round2(Number(row.optionsTotal) + Number(row.customTotal) + Number(row.resourcesTotal) + tax);
    if (!(routed > 0)) continue;
    const uncollected = round2(Number(row.finalPrice || 0) - Number(row.depositAmount || 0) - Number(row.balanceAmount || 0));
    if (uncollected !== routed) continue;
    write.run(routed, row.id);
    history.run(row.id, JSON.stringify([{
      field: 'complementAmount',
      label: "Complément d'arrivée",
      fromText: '0 €',
      toText: `${String(routed.toFixed(2)).replace('.', ',').replace(/,00$/, '')} € (réparé : oublié à la création)`,
    }]));
    repaired.push({ id: row.id, reservationNumber: row.reservationNumber || null, amount: routed });
  }
  return { repaired };
}

module.exports = { runCreatedComplementRepair };
