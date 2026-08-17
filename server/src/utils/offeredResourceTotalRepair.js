/**
 * One-shot repair of the resource lines an offering used to leave at full price —
 * specs/devis-offered-resource-parity.md §3 rule 5.
 *
 * `bookingLinesModel.insertResourceLine` stored `rr.totalPrice || unitPrice * qty`, so the engine's
 * legitimate `totalPrice = 0` on an offered line was read as « no total supplied » and the resource was
 * re-billed at its catalogue price. Every row written that way carries `offered = 1` WITH a price: the
 * devis PDF printed it unmarked and subtracted it from the accommodation, and the finance/accounting
 * reads of that row counted revenue nobody ever charged.
 *
 * The repair is a truth restoration, not an amount change: the reservation's own totals always came
 * from the engine, which had already priced the line at 0. The real price stays recoverable from
 * `unitPrice × billedUnits`, so un-offering the line still re-prices it.
 *
 * Pure + idempotent: a second run matches no row.
 */

function runOfferedResourceTotalRepair(db) {
  const info = db
    .prepare('UPDATE reservation_resources SET totalPrice = 0 WHERE COALESCE(offered, 0) = 1 AND COALESCE(totalPrice, 0) != 0')
    .run();
  return { repairedCount: info.changes };
}

module.exports = { runOfferedResourceTotalRepair };
