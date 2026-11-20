/**
 * The journal entries of a refund (specs/pricing-components.md §3 rules 63 and 64): the avoir of a refund, the requalification
 * of a cancelled stay's money, the share given back from an indemnity, and the closing of a split stay's books. Pure: the
 * refund register and the stay's earlier entries are read by the caller. Moved from the accounting-export plugin.
 */

const { netFirst } = require('../vat');
const {
  bucketFromTtc, round2, CONTRIB_RESIDUE_TOLERANCE_TTC,
} = require('../../accounting/legacyBucketSplit');

// One refund → one avoir entry. Revenue lines are grouped per (bucket, frozen VAT rate) and split
// HT/VAT at that rate; tourist-tax lines ride the 46710000 pass-through with no VAT, exactly like the
// tax portion of an encaissement. No commission, ever (rule 23): the owner refunds the guest directly.
// A `retained` avoir reverses encaissements line for line (one line per installment and bucket,
// specs/direct-installments.md rule 46), so it splits each line on its own, as each encaissement was
// split, and the accounts net to the cent. With one line per bucket, as every acompte avoir has, both
// splits are the same numbers.
// On a cancelled stay, the lines given back from the indemnity (bucket `indemnity`, specs/reservation-refunds.md
// rule 48) debit the indemnity account at its own rate — the mirror of the compensation entry — and never touch
// 706 or VAT on sales: that revenue was already reversed by the cancellation's `retained` avoir.
// A requalification line adjusted for earlier refunds keeps the TTC it was booked on as `unitPrice`
// (specs/payment-schedule-and-cancellation.md rule 55); every other avoir line carries its own amount there.
function isAdjustedLine(line) {
  return line.unitPrice != null && line.bucket !== 'touristTax' && round2(line.unitPrice) !== round2(line.amountTtc);
}

// Rule 55 — the HT / VAT of the earlier refunds, per `${bucket}|${rate}`, as their own entries booked them.
function earlierSplits(earlier) {
  const splits = new Map();
  for (const refund of earlier || []) {
    const entry = buildRefundEntry(refund);
    for (const line of refund.lines || []) {
      if (['touristTax', 'indemnity'].includes(line.bucket)) continue;
      const key = `${line.bucket}|${Number(line.vatRate || 0)}`;
      const current = splits.get(key) || { ttc: 0, vat: 0 };
      current.ttc = round2(current.ttc + Number(line.amountTtc || 0));
      splits.set(key, current);
    }
    for (const bucket of (entry && entry.buckets) || []) {
      const key = `${bucket.name}|${Number(bucket.ratePercent || 0)}`;
      if (splits.has(key)) splits.get(key).vat = round2(splits.get(key).vat + bucket.vat);
    }
  }
  return splits;
}

// Rule 55 — a requalification avoir adjusted for earlier refunds reverses what the books still hold on each bucket.
// Booked there: the acompte's lines (at their `unitPrice`) and the paid solde's share (`solde`); reversed already: the
// earlier refunds (`earlier`); left after the avoir: the sale money the register still offers on the bucket, which a
// refund of it reverses at its own split. So the avoir's VAT is booked − reversed − left, and 706 and 4457 net to the
// cent once that money goes back. A bucket that took a spill from another one splits each line on its own, as before.
function adjustedBucketSplit(name, rate, lines, earlier, solde, deposit) {
  if (!lines.some(isAdjustedLine)) return null;
  const reversed = earlier || { ttc: 0, vat: 0 };
  const sold = solde || { ttc: 0, vat: 0 };
  let bookedTtc = 0;
  let bookedVat = 0;
  let keptTtc = 0;
  for (const line of lines) {
    const booked = round2(isAdjustedLine(line) ? line.unitPrice : line.amountTtc);
    bookedTtc = round2(bookedTtc + booked);
    bookedVat = round2(bookedVat + bookedSplit(name, booked, rate, deposit).vat);
    keptTtc = round2(keptTtc + round2(line.amountTtc));
  }
  const leftTtc = round2(bookedTtc + sold.ttc - reversed.ttc - keptTtc);
  // Kept below what the acompte booked, the bucket took exactly its own refunds (nothing left); kept above, it took
  // the solde money that covered another bucket, and what is left is the rest of that solde money.
  if (keptTtc < bookedTtc ? leftTtc !== 0 : leftTtc < 0) return null;
  const vat = round2(bookedVat + sold.vat - reversed.vat - bucketFromTtc(name, leftTtc, rate).vat);
  if (vat < 0 || vat > keptTtc) return null;
  return { ht: round2(keptTtc - vat), vat };
}

// Rule 55 reading of 2026-11-02 (second review of PR #926) — the HT / VAT an acompte line of the avoir was booked on:
// the acompte entry's own HT for the bucket when the line is that bucket's share (within the residue cents the entry
// put on its VAT line), so the avoir reverses the HT the entry credited and the VAT it really booked; otherwise the
// line split at its rate.
function bookedSplit(name, ttc, rate, deposit) {
  if (deposit && Math.abs(round2(ttc - deposit.ttc)) <= CONTRIB_RESIDUE_TOLERANCE_TTC && ttc >= deposit.ht) {
    return { name, ht: deposit.ht, vat: round2(ttc - deposit.ht), ratePercent: Number(rate || 0) };
  }
  return bucketFromTtc(name, ttc, rate);
}

function buildRefundEntry(refund, { indemnity = null, earlier = null, solde = null, deposit = null } = {}) {
  const lines = refund.lines || [];
  const ttc = round2(refund.totalTtc);
  if (ttc <= 0) return null;

  const perLine = refund.method === 'retained';
  const byBucket = new Map(); // `${bucket}|${rate}` → { name, ttc, ht, vat, ratePercent }
  let taxTtc = 0;
  let indemnityTtc = 0;
  for (const line of lines) {
    const amount = round2(line.amountTtc);
    if (amount <= 0) continue;
    if (line.bucket === 'touristTax') { taxTtc = round2(taxTtc + amount); continue; }
    if (line.bucket === 'indemnity') { indemnityTtc = round2(indemnityTtc + amount); continue; }
    const rate = Number(line.vatRate || 0);
    const mapKey = `${line.bucket}|${rate}`;
    const current = byBucket.get(mapKey) || { name: line.bucket, ttc: 0, ht: 0, vat: 0, ratePercent: rate };
    current.ttc = round2(current.ttc + amount);
    const part = bucketFromTtc(line.bucket, amount, rate);
    current.ht = round2(current.ht + part.ht);
    current.vat = round2(current.vat + part.vat);
    byBucket.set(mapKey, current);
  }

  const splits = perLine && earlier ? earlierSplits(earlier) : null;
  const buckets = [...byBucket.values()]
    .map((b) => {
      if (!perLine) return bucketFromTtc(b.name, b.ttc, b.ratePercent);
      const key = `${b.name}|${b.ratePercent}`;
      const bucketLines = lines.filter((line) => line.bucket === b.name && Number(line.vatRate || 0) === b.ratePercent && round2(line.amountTtc) > 0);
      const depositSplit = deposit ? deposit.get(key) : null;
      const netted = splits ? adjustedBucketSplit(b.name, b.ratePercent, bucketLines, splits.get(key), solde && solde.get(key), depositSplit) : null;
      if (netted) return { name: b.name, ...netted, ratePercent: b.ratePercent };
      // One line per bucket, as every acompte avoir has: it mirrors the acompte entry.
      const mirrored = depositSplit && bucketLines.length === 1 && !isAdjustedLine(bucketLines[0])
        ? bookedSplit(b.name, b.ttc, b.ratePercent, depositSplit) : b;
      return { name: b.name, ht: mirrored.ht, vat: mirrored.vat, ratePercent: b.ratePercent };
    })
    .filter((b) => b.ht > 0 || b.vat > 0);

  return {
    reservationId: refund.reservationId,
    refundId: refund.id,
    kind: 'refund',
    direction: 'refund',
    paidDate: refund.refundDate,
    client: { firstName: refund.firstName || '', lastName: refund.lastName || '' },
    propertyName: refund.propertyName || '',
    platform: refund.platform || 'direct',
    clientGrossAmount: null,
    finalPrice: ttc,
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc,
    fraction: 1,
    buckets,
    ...(indemnityTtc > 0 ? { indemnity: indemnityShare(indemnityTtc, indemnity) } : {}),
    reason: refund.reason || '',
    method: refund.method,
  };
}

// Split cumulatively over the stay: this share's HT is HT(given back so far + it) − HT(given back so far), so once the
// whole indemnity is given back the shares' HT add up to the compensation's HT, at any rate (rule 48).
function indemnityShare(ttc, config) {
  const rate = Number(config && config.vatRatePercent) || 0;
  const prior = round2(Number(config && config.priorTtc) || 0);
  const htOf = (amount) => netFirst(amount, rate).net;
  const ht = rate > 0 ? round2(htOf(prior + ttc) - htOf(prior)) : ttc;
  return { account: (config && config.account) || null, ht, vat: round2(ttc - ht), ratePercent: rate };
}

// specs/mixed-method-payments.md rule 56 — the refund that gives back the last of its book money debits what is left on each
// sale account instead of its lines. `entriesOfStay` / `earlierRefundsOf` / `entryOf` read the stay's entries and its
// earlier refunds, `addSaleLegs` sums what an entry left on the sale accounts.
function closeStayBooks(entry, row, { entriesOfStay, earlierRefundsOf, entryOf, addSaleLegs }) {
  const left = new Map();
  for (const e of entriesOfStay(row.reservationId)) if (String(e.paidDate || '') <= row.refundDate) addSaleLegs(left, e);
  for (const other of earlierRefundsOf(row)) {
    const e = entryOf(other);
    if (e) addSaleLegs(left, e);
  }
  const own = addSaleLegs(new Map(), entry);
  const sum = (legs) => [...legs.values()].reduce((total, leg) => total + leg.cents, 0);
  if (sum(left) !== -sum(own)) return entry;
  const closing = [...left.entries()].filter(([, leg]) => leg.cents !== 0)
    .map(([account, leg]) => ({ account, role: leg.role, ratePercent: leg.ratePercent, amount: leg.cents / 100 }));
  return { ...entry, closing };
}

module.exports = {
  buildRefundEntry,
  isAdjustedLine,
  earlierSplits,
  adjustedBucketSplit,
  indemnityShare,
  closeStayBooks,
};
