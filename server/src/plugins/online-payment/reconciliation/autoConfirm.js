/**
 * Automatic confirmation of certain matches (specs/reconciliation-assisted-matching.md rules 20–21).
 *
 * After each read of the account the server confirms by itself the proposals that leave no room for doubt:
 * « sûr », one credit onto one receipt, the receipt's bank amount known and equal to the credit to the
 * cent, the credit entirely consumed. The write is the paid flag and the date, never a payout or an
 * amount (the writer's `auto` mode); each line is stored with `auto = 1` and no user, and « Défaire »
 * discards the pair so it is never confirmed again.
 *
 * Pure selection (`eligible`) + the run, which confirms through the controller's own write path.
 */

const { day } = require('./dates');

/**
 * @param {object} data the controller's computed pass (`receiptsByKey`, `byTransaction`, `txById`, `allocatedOf`)
 * @returns {{ proposal: object, pair: object }[]}
 */
function eligible(data) {
  const out = [];
  const seen = new Set();
  Object.values(data.byTransaction).forEach((slot) => {
    const p = slot.proposal;
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    if (p.confidence !== 'sur' || p.parts || p.needsShares || p.allocations.length !== 1) return;
    const [alloc] = p.allocations;
    const receipt = data.receiptsByKey.get(`${alloc.reservationId}|${alloc.ledgerKey}`);
    const tx = data.txById.get(p.transactionId);
    if (!receipt || !tx || receipt.unbounded || receipt.alreadyCovered) return;
    const remaining = tx.amountCents - (data.allocatedOf.get(tx.id) || 0);
    // Automatic only for a credit dated on or after checkout: before it, the stay's own payout is not due yet.
    const checkOut = receipt && receipt.reservation && String(receipt.reservation.endDate || '').slice(0, 10);
    if (checkOut && receipt.channel.startsWith('platform:') && tx && day(tx.settledAt) < checkOut) return;
    if (!(receipt.needCents > 0) || alloc.amountCents !== receipt.needCents || remaining !== alloc.amountCents) return;
    out.push({ proposal: p, pair: { transactionId: p.transactionId, reservationId: alloc.reservationId, ledgerKey: alloc.ledgerKey, amountCents: alloc.amountCents } });
  });
  return out;
}

/**
 * @param {object} deps
 * @param {() => object} deps.compute        a fresh pass over stored data
 * @param {(args: object) => object} deps.confirm  the controller's write path (`{ pairs, auto: true }`)
 * @returns {{ count: number, keys: string[] }} the receipts confirmed alone, `reservationId|ledgerKey`
 */
function runAutoConfirm({ compute, confirm }) {
  const keys = [];
  eligible(compute()).forEach(({ pair }) => {
    // The previous confirmation changed the fiches: a pair is re-checked on fresh data before it is written.
    const still = eligible(compute()).find((e) => e.pair.transactionId === pair.transactionId && e.pair.reservationId === pair.reservationId && e.pair.ledgerKey === pair.ledgerKey);
    if (!still) return;
    const answer = confirm({ pairs: [pair], auto: true });
    if (answer.status < 400) keys.push(`${pair.reservationId}|${pair.ledgerKey}`);
  });
  return { count: keys.length, keys };
}

module.exports = { eligible, runAutoConfirm };
