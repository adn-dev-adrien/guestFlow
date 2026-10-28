/**
 * The linen at the laundry, as batches (specs/linen-laundry-days.md §3.2 rules 10-11, §3.3 rule 15).
 *
 * A batch is what one trip dropped: `{ dropDate, readyFrom, counts }`, `counts` an object of
 * integer quantities per linen key. The laundry holds a list of them, oldest first. A trip collects
 * the batches whose `readyFrom` has come; a batch not ready yet stays. Shared by the Planning ledger
 * (keys `singleBeds`…) and the stock engine (keys `single`…), so the two collect the same way.
 * Pure — no DB, no mutation of its inputs.
 */

const sumOf = (counts) => Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);

/** Append a batch; an empty drop leaves no batch behind. */
function addBatch(batches, { dropDate, readyFrom, counts }) {
  if (sumOf(counts) <= 0) return batches;
  return [...batches, { dropDate, readyFrom, counts: { ...counts } }];
}

/**
 * Collect on `date`. `wanted` is `null` for « everything that is ready », or per-key quantities (a
 * partial pick-up): each key is served oldest batch first, capped at what is ready.
 *
 * @returns {{ collected: object, fromTrips: string[], remaining: Array }} `fromTrips` are the drop
 *   dates something was collected from, oldest first.
 */
function collectBatches(batches, date, keys, wanted = null) {
  const collected = {};
  const quota = {};
  for (const k of keys) {
    collected[k] = 0;
    quota[k] = wanted ? Math.max(0, Number(wanted[k]) || 0) : Infinity;
  }
  const fromTrips = [];
  const remaining = [];
  for (const batch of batches) {
    if (batch.readyFrom > date) { remaining.push(batch); continue; }
    const left = { ...batch.counts };
    let tookAny = false;
    for (const k of keys) {
      const take = Math.min(Number(left[k]) || 0, quota[k]);
      if (take > 0) {
        left[k] -= take;
        quota[k] -= take;
        collected[k] += take;
        tookAny = true;
      }
    }
    if (tookAny) fromTrips.push(batch.dropDate);
    if (sumOf(left) > 0) remaining.push({ ...batch, counts: left });
  }
  return { collected, fromTrips, remaining };
}

/** Everything still at the laundry: the summed counts and the earliest date any of it is ready. */
function totalOf(batches, keys) {
  const counts = {};
  for (const k of keys) counts[k] = 0;
  let readyOn = null;
  for (const b of batches) {
    for (const k of keys) counts[k] += Number(b.counts[k]) || 0;
    if (readyOn === null || b.readyFrom < readyOn) readyOn = b.readyFrom;
  }
  return { counts, readyOn };
}

module.exports = { addBatch, collectBatches, totalOf, sumOf };
