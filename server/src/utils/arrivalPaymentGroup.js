/**
 * The single payment made at check-in (specs/single-payment-at-check-in.md §3.2).
 *
 * A last-minute guest hands over ONE card for the stay AND the arrival complement. The two stay
 * separate buckets — they carry different revenue accounts and different VAT rates, and merging them
 * is the one thing that feature must not do — so what is recorded is the **group**: which buckets one
 * collection covered, when, by what means, and for how much.
 *
 * The group is written, never derived. « Same date + same cash flag » would silently merge a
 * complement genuinely collected by a second card payment on the same day into the first, and leave
 * the operator no way to say it was wrong.
 *
 * Pure — no DB access. Stored as JSON in `reservations.arrivalPaymentGroup`, NULL when there is none.
 */

const BUCKETS = ['deposit', 'balance', 'complement'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build a group, or null when there is nothing to record (no bucket, no money).
 *
 * @param {object} p
 * @param {string} p.at      payment date, `YYYY-MM-DD`
 * @param {boolean} p.cash   collected into the caisse interne
 * @param {number} p.total   what the guest actually handed over — kept as collected, so a later
 *                           complement adjustment never rewrites history (§3.4 edge case)
 * @param {string[]} p.buckets  which buckets this one collection covered
 * @returns {{at: string, cash: 0|1, total: number, buckets: string[]}|null}
 */
function buildGroup({ at, cash, total, buckets } = {}) {
  const date = String(at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const kept = [...new Set((Array.isArray(buckets) ? buckets : []).map(String))]
    .filter((b) => BUCKETS.includes(b))
    .sort((a, b) => BUCKETS.indexOf(a) - BUCKETS.indexOf(b));
  // A group of one is not a group: a single bucket settled on its own is an ordinary payment, and
  // recording it as a group would make the fiche announce a « paiement unique » that groups nothing.
  if (kept.length < 2) return null;
  const amount = round2(total);
  if (!(amount > 0)) return null;
  return { at: date, cash: cash ? 1 : 0, total: amount, buckets: kept };
}

/** Parse the stored JSON back, tolerating anything: an unreadable group is simply no group. */
function parseGroup(raw) {
  if (raw == null || raw === '') return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return buildGroup(parsed);
}

/** Does this group cover that bucket? Used to decide whether un-settling it kills the group. */
function groupCovers(group, bucket) {
  const g = parseGroup(group);
  return Boolean(g && g.buckets.includes(String(bucket)));
}

/** Serialise for storage; null when there is no group to store. */
function serialiseGroup(group) {
  const g = buildGroup(group || {});
  return g ? JSON.stringify(g) : null;
}

/**
 * The arrival buckets that can still be collected (specs/single-payment-from-the-fiche.md rule 2):
 * applicable, worth something, and not yet paid. Shared by the fiche payload and the write, so the
 * operator can never be offered a bucket the server would then refuse.
 *
 * The acompte of a stay with `depositDisabled` is not applicable; a 0 € complement is nothing to
 * collect; a bucket already paid — by transfer, or earlier at the door — is left alone.
 *
 * @returns {Array<{bucket: 'deposit'|'balance'|'complement', label: string, amount: number}>}
 */
function collectibleArrivalBuckets(row = {}) {
  const out = [];
  const add = (bucket, label, amount, applicable, paid) => {
    const value = round2(amount);
    if (!applicable || !(value > 0) || Number(paid || 0) === 1) return;
    out.push({ bucket, label, amount: value });
  };
  add('deposit', 'acompte', row.depositAmount, Number(row.depositDisabled || 0) !== 1, row.depositPaid);
  add('balance', 'solde', row.balanceAmount, true, row.balancePaid);
  add('complement', 'complément', row.complementAmount, true, row.complementPaid);
  return out;
}

module.exports = {
  BUCKETS, buildGroup, parseGroup, groupCovers, serialiseGroup, collectibleArrivalBuckets,
};
