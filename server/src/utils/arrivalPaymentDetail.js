/**
 * What the single arrival payment actually paid for, line by line
 * (specs/arrival-payment-detail-and-adjustment.md §3.1).
 *
 * The group records which BUCKETS one collection covered — acompte, solde, complément d'arrivée,
 * complément de fin de séjour. « solde 720,82 € » answers *which column stores this money*; the
 * operator, and the guest asking « c'est quoi les 852 € ? », want *what did he pay for*: the nights,
 * le linge, le repas, la taxe de séjour. This composes that list.
 *
 * Two invariants make it trustworthy rather than decorative:
 *
 *   1. **The lines sum to the buckets.** The accommodation is the RESIDUAL of its bucket — what is
 *      left once the options, the ressources and the taxe de séjour of that bucket are named — so no
 *      rounding of the snapshots can leave the detail disagreeing with the amount above it.
 *   2. **The shares come from the contribution snapshots** captured when the money was flipped to
 *      paid (`accommodationSoldeContribTtc`, `touristTaxSoldeContribTtc`, the per-line
 *      `acompteContribTtc` / `soldeContribTtc`) — the very numbers the Comptabilité credits. The
 *      fiche and the journal are then the same arithmetic, not two implementations that agree today.
 *      A bucket whose capture legitimately failed (a platform booking, a stay marked paid outside the
 *      app) degrades to ONE line named after it; it never invents a split.
 *
 * Pure — no DB. The caller hands in the reservation (`getByIdWithDetails` shape) and the arrival
 * complement's own detail. Unit-tested in tests/arrival-payment-detail.unit.test.js.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nz = (v) => (v == null ? 0 : Number(v) || 0);

// The two stay buckets, in the order they are collected, with the columns each one reads.
const STAY_BUCKETS = [
  {
    bucket: 'deposit',
    label: 'Acompte',
    amountCol: 'depositAmount',
    lineCol: 'acompteContribTtc',
    accommodationCol: 'accommodationAcompteContribTtc',
    taxCol: 'touristTaxAcompteContribTtc',
  },
  {
    bucket: 'balance',
    label: 'Solde',
    amountCol: 'balanceAmount',
    lineCol: 'soldeContribTtc',
    accommodationCol: 'accommodationSoldeContribTtc',
    taxCol: 'touristTaxSoldeContribTtc',
  },
];

function nightsOf(reservation) {
  if (Array.isArray(reservation.nights) && reservation.nights.length > 0) return reservation.nights.length;
  const start = Date.parse(`${String(reservation.startDate || '').slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(reservation.endDate || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86400000);
}

// One entry per billable line of the reservation, in a shape both loops below can read.
function billableLines(reservation) {
  const out = [];
  for (const o of (reservation.options || [])) {
    const isCustom = Number(o.isCustom || 0) === 1;
    out.push({
      key: isCustom ? `custom:${o.customOptionId}` : `option:${o.optionId}`,
      kind: 'option',
      label: String((isCustom ? (o.description || o.title) : (o.title || o.description)) || 'Extra').trim(),
      qty: Number(o.billedUnits || o.quantity || 1),
      unitPrice: round2(o.unitPrice),
      offered: Number(o.offered || 0) === 1,
      inComplement: Number(o.inComplement || 0) === 1,
      originalTotalPrice: round2(o.originalTotalPrice != null ? o.originalTotalPrice : o.totalPrice),
      contribs: { acompteContribTtc: o.acompteContribTtc, soldeContribTtc: o.soldeContribTtc },
    });
  }
  for (const r of (reservation.resources || [])) {
    out.push({
      key: `resource:${r.resourceId}`,
      kind: 'resource',
      label: String(r.name || 'Ressource').trim(),
      qty: Number(r.billedUnits || r.quantity || 1),
      unitPrice: round2(r.unitPrice),
      offered: Number(r.offered || 0) === 1,
      inComplement: Number(r.inComplement || 0) === 1,
      originalTotalPrice: round2(r.originalTotalPrice != null ? r.originalTotalPrice : r.totalPrice),
      contribs: { acompteContribTtc: r.acompteContribTtc, soldeContribTtc: r.soldeContribTtc },
    });
  }
  return out;
}

// The end-of-stay complement's stored lines, topped up with a remainder so they sum to its amount —
// the same guarantee `arrivalComplementDetailFromReservation` gives the arrival one.
function endOfStayLines(reservation) {
  let stored = [];
  try {
    const parsed = typeof reservation.endOfStayComplementDetail === 'string'
      ? JSON.parse(reservation.endOfStayComplementDetail)
      : reservation.endOfStayComplementDetail;
    stored = Array.isArray(parsed) ? parsed : [];
  } catch { stored = []; }
  const lines = stored
    .filter((l) => l && String(l.label || '').trim())
    .map((l) => ({
      kind: 'endOfStay',
      label: String(l.label).trim(),
      qty: Number(l.qty || 1),
      unitPrice: round2(l.unitPrice != null ? l.unitPrice : l.amount),
      amount: round2(l.amount),
    }))
    .filter((l) => l.amount > 0);
  const amount = round2(reservation.endOfStayComplementAmount);
  const listed = round2(lines.reduce((s, l) => s + l.amount, 0));
  const remainder = round2(amount - listed);
  if (remainder > 0.01) {
    lines.push({
      kind: 'endOfStay', label: 'Complément de fin de séjour', qty: 1, unitPrice: remainder, amount: remainder,
    });
  }
  return lines;
}

/**
 * @param {object} reservation `getByIdWithDetails` shape (options, resources, amounts, contribs).
 * @param {object} input
 * @param {string[]} input.buckets   the group's buckets.
 * @param {{detail: Array}} [input.complementDetail] the arrival complement's own itemisation, built
 *        with `includeOffered: true` so a geste commercial stays visible at 0 €.
 * @returns {{lines: Array, accommodation: number, bucketsTotal: number}}
 */
function buildArrivalPaymentDetail(reservation, { buckets = [], complementDetail = null } = {}) {
  const covered = new Set(buckets.map(String));
  const lines = [];
  const all = billableLines(reservation);

  // ── The stay buckets ──────────────────────────────────────────────────────
  // Merged, not concatenated: an option split between the acompte and the solde is ONE prestation the
  // guest bought, and listing it twice would read as two.
  const byKey = new Map();
  const fallback = [];
  let accommodation = 0;
  let tax = 0;
  let bucketsTotal = 0;

  for (const stay of STAY_BUCKETS) {
    if (!covered.has(stay.bucket)) continue;
    const amount = round2(reservation[stay.amountCol]);
    bucketsTotal = round2(bucketsTotal + amount);
    if (!(amount > 0)) continue;
    const preArrival = all.filter((l) => !l.inComplement);
    const hasSnapshot = reservation[stay.accommodationCol] != null
      || reservation[stay.taxCol] != null
      || preArrival.some((l) => l.contribs[stay.lineCol] != null);
    if (!hasSnapshot) {
      fallback.push({ kind: 'bucket', label: stay.label, qty: 1, unitPrice: amount, amount });
      continue;
    }
    let named = 0;
    for (const line of preArrival) {
      const share = round2(nz(line.contribs[stay.lineCol]));
      if (!(share > 0)) continue;
      named = round2(named + share);
      const existing = byKey.get(line.key);
      if (existing) existing.amount = round2(existing.amount + share);
      else {
        byKey.set(line.key, {
          kind: line.kind, label: line.label, qty: line.qty, unitPrice: line.unitPrice, amount: share,
        });
      }
    }
    const taxShare = round2(nz(reservation[stay.taxCol]));
    if (taxShare > 0) {
      named = round2(named + taxShare);
      tax = round2(tax + taxShare);
    }
    // Rule 7 — the accommodation is what is left, so the lines can never drift from the bucket.
    accommodation = round2(accommodation + Math.max(0, round2(amount - named)));
  }

  const staySnapshotted = byKey.size > 0 || accommodation > 0 || tax > 0;
  if (accommodation > 0) {
    const nights = nightsOf(reservation);
    lines.push({
      kind: 'accommodation',
      label: nights > 0 ? `Hébergement — ${nights} nuit${nights > 1 ? 's' : ''}` : 'Hébergement',
      qty: 1,
      unitPrice: accommodation,
      amount: accommodation,
    });
  }
  lines.push(...byKey.values());
  // A geste commercial on a pre-arrival line: it is part of what the guest received, so it shows at
  // 0 € with its original struck through rather than vanishing from the list.
  if (staySnapshotted) {
    for (const line of all) {
      if (line.inComplement || !line.offered || !(line.originalTotalPrice > 0)) continue;
      lines.push({
        kind: line.kind,
        label: line.label,
        qty: line.qty,
        unitPrice: line.unitPrice,
        amount: 0,
        offered: 1,
        originalAmount: line.originalTotalPrice,
      });
    }
  }
  lines.push(...fallback);

  // ── The complements ───────────────────────────────────────────────────────
  if (covered.has('complement')) {
    bucketsTotal = round2(bucketsTotal + round2(reservation.complementAmount));
    for (const line of ((complementDetail && complementDetail.detail) || [])) {
      // The taxe de séjour is collected once and shown once, whichever bucket carries it.
      if (line.kind === 'tax') { tax = round2(tax + round2(line.amount)); continue; }
      lines.push({
        kind: line.kind === 'resource' ? 'resource' : 'option',
        label: line.label,
        qty: Number(line.qty || 1),
        unitPrice: round2(line.unitPrice),
        amount: round2(line.amount),
        ...(line.offered ? { offered: 1, originalAmount: round2(line.originalAmount) } : {}),
      });
    }
  }
  if (covered.has('endOfStayComplement')) {
    bucketsTotal = round2(bucketsTotal + round2(reservation.endOfStayComplementAmount));
    lines.push(...endOfStayLines(reservation));
  }

  if (tax > 0) {
    lines.push({ kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: tax, amount: tax });
  }

  return { lines, accommodation, bucketsTotal };
}

module.exports = { buildArrivalPaymentDetail };
