/**
 * SETTLEMENT — how the amounts the stay asks for are filed by the moment they are collected, and what money already in
 * says about them (specs/pricing-components.md §3 rules 18-23, 29, 42, 48).
 *
 * Contract:
 * - `readInComplement({ finalOptionLines, resourceLines, extraGuestComplementSurcharge, midStayForced })` →
 *   `{ forcedItemsTotal, complementForcedItemsTotal }`: the lines routed to the arrival complement (`inComplement`), the
 *   extra guests billed there, less the part sold during the stay;
 * - `resolveMidStaySplit(lines, { baseline, settled, storedLines, notes })` and the mid-stay helpers: what exceeds the
 *   arrival baseline was sold during the stay and is billed at check-out; the notes already collected (a card paid in
 *   advance) are netted out of what is still due;
 * - `planSettlement({ lines, stayLevel, receipts })` → `{ complementDetailLines, complementSplit }`: the live itemisation of
 *   the arrival complement and the three amounts (arrival, during the stay, end of stay) filed by moment;
 * - `splitComplementBuckets`, `isComplementDeferred` and the settled-state readers of a stored row.
 *
 * The code moved from `midStayExtras`, `complementBuckets`, `checkoutComplement` and the engine as it was; those modules
 * re-export it. The two netting copies of `complementPaidSplit.prepaidNetter` / `arrivalPaymentDetail` stay where they are
 * (PR B). Pure: no DB, no clock, no settings.
 */
const { parseGroup } = require('../arrivalPaymentGroup');
const { ADDED_GUESTS_TAX_LABEL } = require('../platformPaidGuests');
const { roundMoney } = require('./money');
const { extraLineKey, parseNotes, settledByKey, parseDetail } = require('./storedLines');

/**
 * Prestations vendues EN COURS DE SÉJOUR — specs/mid-stay-extras-to-end-of-stay-complement.md.
 *
 * Every bucket of a reservation freezes once it is paid (deposit/balance at pricing.js, arrival
 * complement at `complementPaid`). An extra sold while the guest is already in the property therefore
 * grew the stay total without growing any collection target: the money was billed nowhere.
 *
 * The fix is a BASELINE — the extras as they stood when the stay started (`arrivalExtrasBaseline`).
 * Whatever exceeds that baseline was sold during the stay and belongs to the « complément de fin de
 * séjour ». The split is done on AMOUNTS, not on whole lines: bumping an option from 1 to 2 units
 * mid-stay only moves the added unit.
 *
 * Everything here is pure (no DB, no clock) — the callers own the persistence:
 *   pricing.js            routes the mid-stay part out of the pre-arrival / arrival-complement buckets,
 *   reservationsModel.js  captures the baseline + syncs `endOfStayComplementDetail`,
 *   accountingModel.js    keeps the mid-stay part out of the `complement` journal entry.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Tag carried by the end-of-stay detail lines this module owns. The departure SAS re-sends every
// `source`-tagged line verbatim (specs/sas-bath-linen-upsell.md §3.3), so tagging is what makes a
// mid-stay line survive a check-out commit.
const MID_STAY_SOURCE = 'midStayExtra';

// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20 — what the stay gained after its arrival
// complement was collected, billed at check-out on a line of its own. It was routed to the arrival
// complement, so once frozen it counts as « forced » (out of the acompte/solde split), like the
// complement it could not join.
const ARRIVAL_COMPLEMENT_EXCESS_KEY = 'arrivalComplementExcess';
const ARRIVAL_COMPLEMENT_EXCESS_LABEL = "Ajouté après l'encaissement du complément d'arrivée";

function lineLabel(line) {
  return String(line.title || line.name || line.description || 'Prestation').trim();
}

/**
 * Baseline snapshot of a set of extra lines: `{ key → TTC }`. Offered lines carry 0 and are skipped
 * (they can never be billed, mid-stay or not).
 */
function buildExtrasBaseline(lines) {
  const baseline = {};
  for (const line of (lines || [])) {
    if (!line || Number(line.offered || 0) === 1) continue;
    const key = extraLineKey(line);
    if (!key) continue;
    const total = round2(line.totalPrice);
    if (total <= 0) continue;
    baseline[key] = round2((baseline[key] || 0) + total);
  }
  return baseline;
}

/**
 * Rules 21, 31 (class E8) — a stay with no arrival baseline yet (its check-in hour is not reached: rule 19 sends a new sale to the
 * arrival) whose settled notes name lines: what a note collected is money the guest already paid, so it leaves the arrival
 * complement and the pre-arrival split exactly as a sale of the stay does. The baseline is then what each such line carried
 * before the note: its total less what the notes collected on it. Null when no note names a line.
 */
function prepaidBaseline(lines, settled) {
  if (!Object.keys(settled).length) return null;
  const baseline = buildExtrasBaseline(lines);
  const named = Object.keys(settled).filter((key) => baseline[key] > 0);
  if (!named.length) return null;
  for (const key of named) baseline[key] = round2(Math.max(0, baseline[key] - settled[key]));
  return baseline;
}

/**
 * Rule 82 — the arrival baseline of a stay whose departure is over, with the automatic options its lines never stored. They are
 * derived from the stay's own times, so they were never sold during the stay: each is part of what the stay carried at arrival.
 * No baseline (null) stays null.
 */
function baselineWithDerivedLines(baselineRaw, derivedLines) {
  const parsed = parseBaseline(baselineRaw);
  if (!parsed) return baselineRaw;
  const derived = buildExtrasBaseline(derivedLines);
  const baseline = { ...derived, ...parsed };
  return JSON.stringify(baseline);
}

function parseBaseline(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

/**
 * Split the current extra lines against the baseline.
 *
 * @param {Array}  lines    option + resource + custom lines as produced by the pricing engine.
 * @param {object|string|null} baselineRaw `arrivalExtrasBaseline` (JSON string or object). null/absent
 *        → the stay has not started yet: nothing is mid-stay, the split is a no-op.
 * @param {Array|string|null} notesRaw `midStaySettledNotes` — what was already collected during the
 *        stay (specs/mid-stay-notes.md §3.3 rule 9). Deducted from the REMAINDER only: the whole
 *        mid-stay amount keeps being carved out of the frozen buckets, money already in the till
 *        never flows back into the acompte/solde/complément d'arrivée.
 * @returns {{ total:number, forced:number, unforced:number, byKey:object,
 *             remainingTotal:number, settledTotal:number, lines:Array }}
 *          `lines` are ready-to-store end-of-stay detail lines (the REMAINDER);
 *          `total`/`forced`/`unforced`/`byKey` cover the whole mid-stay (remainder + settled).
 */
function splitMidStayExtras(lines, baselineRaw, notesRaw) {
  const settled = settledByKey(notesRaw);
  const baseline = parseBaseline(baselineRaw) || prepaidBaseline(lines, settled);
  const empty = {
    total: 0, forced: 0, unforced: 0, byKey: {}, remainingTotal: 0, settledTotal: 0, lines: [],
  };
  if (!baseline) return empty;

  // Aggregate per key first: two custom lines sharing a label are one key on both sides.
  const currentByKey = new Map();
  for (const line of (lines || [])) {
    if (!line || Number(line.offered || 0) === 1) continue;
    const key = extraLineKey(line);
    if (!key) continue;
    const total = round2(line.totalPrice);
    if (total <= 0) continue;
    const entry = currentByKey.get(key);
    if (entry) {
      entry.total = round2(entry.total + total);
      // A key is « forced » as soon as one of its lines is routed to the complement.
      entry.forced = entry.forced || Number(line.inComplement || 0) === 1;
    } else {
      currentByKey.set(key, {
        key,
        total,
        forced: Number(line.inComplement || 0) === 1,
        label: lineLabel(line),
        unitPrice: round2(line.unitPrice),
      });
    }
  }

  const result = {
    total: 0, forced: 0, unforced: 0, byKey: {}, remainingTotal: 0, settledTotal: 0, lines: [],
  };
  for (const entry of currentByKey.values()) {
    // Removing or shrinking a line brings the mid-stay part back to 0 — never negative.
    const amount = round2(Math.max(0, entry.total - round2(baseline[entry.key])));
    if (amount <= 0) continue;
    result.total = round2(result.total + amount);
    if (entry.forced) result.forced = round2(result.forced + amount);
    else result.unforced = round2(result.unforced + amount);
    result.byKey[entry.key] = amount;
    // What is left to collect at check-out: the sale minus what notes already collected. Settling
    // MORE than what is currently sold (a line was removed after payment) clamps here, never below 0.
    const paid = round2(Math.min(round2(settled[entry.key]), amount));
    result.settledTotal = round2(result.settledTotal + paid);
    const remaining = round2(amount - paid);
    if (remaining <= 0) continue;
    result.remainingTotal = round2(result.remainingTotal + remaining);
    result.lines.push(buildMidStayLine({
      label: entry.label, unitPrice: entry.unitPrice, amount: remaining, key: entry.key,
    }));
  }
  result.lines.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return result;
}

/**
 * One ready-to-store end-of-stay detail line. Whole units → « 2 × 12 € = 24 € »; anything else
 * (a partially settled line, a rounded price) stays a flat amount rather than showing a misleading
 * « × ». Shared by the split and by the settle/cancel transactions so a line looks the same
 * wherever it was built.
 */
function buildMidStayLine({ label, unitPrice, amount, key }) {
  const unit = round2(unitPrice);
  const total = round2(amount);
  const units = unit > 0 ? total / unit : 0;
  const wholeUnits = Number.isInteger(round2(units)) && round2(units) >= 2 ? round2(units) : 1;
  return {
    label,
    qty: wholeUnits,
    unitPrice: wholeUnits > 1 ? unit : total,
    amount: total,
    source: MID_STAY_SOURCE,
    key,
  };
}

function notesTotal(notesRaw) {
  return round2(parseNotes(notesRaw).reduce((s, n) => s + (Number(n && n.total) || 0), 0));
}

// Per-reservation increment, so cancelling a note is unambiguous even after several settlements.
function nextNoteId(notesRaw) {
  return parseNotes(notesRaw).reduce((max, n) => Math.max(max, Number(n && n.id) || 0), 0) + 1;
}

/**
 * Same shape as `splitMidStayExtras`, rebuilt from the mid-stay lines ALREADY STORED in the
 * end-of-stay detail. Used once that complement is collected (§3.5 rule 18): the collected amounts
 * must keep being carved out of the other buckets, but must never be re-priced. The forced/unforced
 * routing is read from the current lines (a line's `inComplement` flag can still be flipped).
 * The settled notes are added ON TOP of the stored remainder: both must stay out of the frozen
 * buckets (specs/mid-stay-notes.md §3.3 rule 9).
 */
function splitFromStoredLines(storedLines, currentLines, notesRaw) {
  const forcedKeys = new Set();
  for (const line of (currentLines || [])) {
    if (!line || Number(line.inComplement || 0) !== 1) continue;
    const key = extraLineKey(line);
    if (key) forcedKeys.add(key);
  }
  forcedKeys.add(ARRIVAL_COMPLEMENT_EXCESS_KEY);
  const result = {
    total: 0, forced: 0, unforced: 0, byKey: {}, remainingTotal: 0, settledTotal: 0, lines: [],
  };
  const add = (key, amount) => {
    result.total = round2(result.total + amount);
    if (key && forcedKeys.has(key)) result.forced = round2(result.forced + amount);
    else result.unforced = round2(result.unforced + amount);
    if (key) result.byKey[key] = round2((result.byKey[key] || 0) + amount);
  };
  for (const line of (storedLines || [])) {
    const amount = round2(line && line.amount);
    if (amount <= 0) continue;
    add(line.key || extraLineKey(line), amount);
    result.remainingTotal = round2(result.remainingTotal + amount);
    result.lines.push({ ...line });
  }
  for (const [key, amount] of Object.entries(settledByKey(notesRaw))) {
    if (amount <= 0) continue;
    add(key, amount);
    result.settledTotal = round2(result.settledTotal + amount);
  }
  return result;
}

/**
 * The one decision every consumer shares: while the end-of-stay complement is still to collect the
 * split is recomputed from the baseline; once collected it is read back from the stored lines so a
 * collected amount is carved out of the other buckets without ever being re-priced (§3.5).
 */
function resolveMidStaySplit(lines, { baseline, settled, storedLines, notes } = {}) {
  return settled
    ? splitFromStoredLines(storedLines, lines, notes)
    : splitMidStayExtras(lines, baseline, notes);
}

// Sum of the end-of-stay detail lines the departure SAS owns (ménage, linge manquant, extincteur,
// linge de toilette différé…) — i.e. everything except the mid-stay lines this module writes.
function sasDetailAmount(detailRaw) {
  return round2(parseDetail(detailRaw)
    .filter((l) => l && l.source !== MID_STAY_SOURCE)
    .reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

// Same sum, without the « Ajustement » line (specs/adjustable-complement-amounts.md §3.3) — c'est le
// complément de fin de séjour AVANT l'ajustement de l'opérateur, celui que la fiche affiche sous le
// champ en « Calcul auto (X €) ».
function sasDetailAmountAuto(detailRaw) {
  return round2(parseDetail(detailRaw)
    .filter((l) => l && l.source !== MID_STAY_SOURCE && l.source !== 'adjustment')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

// The mid-stay lines already stored in the detail — the frozen set used once the end-of-stay
// complement has been collected (§3.5 rule 18).
function storedMidStayLines(detailRaw) {
  return parseDetail(detailRaw).filter((l) => l && l.source === MID_STAY_SOURCE);
}

/**
 * Rewrite the end-of-stay detail with a fresh set of mid-stay lines, preserving every SAS-owned line
 * in place. Derived, never incremental: the previous mid-stay lines are dropped, not adjusted.
 * @returns {{ detail: Array, amount: number }}
 */
function mergeMidStayIntoDetail(detailRaw, midStayLines) {
  const detail = [
    ...parseDetail(detailRaw).filter((l) => l && l.source !== MID_STAY_SOURCE),
    ...(midStayLines || []),
  ];
  const amount = round2(Math.max(0, detail.reduce((s, l) => s + (Number(l.amount) || 0), 0)));
  return { detail, amount };
}


/**
 * Complements ranked by the MOMENT they are collected — specs/complement-buckets-by-moment.md.
 *
 * The database stores complements by bucket of origin (`complementAmount` = arrival,
 * `endOfStayComplementAmount` = check-out, settled notes = during the stay). What the operator reads
 * on the fiche is a different question: *when* is this money taken? That question has exactly one
 * answer, and it is the operator's: the « Percevoir en fin de séjour » marker
 * (specs/defer-arrival-complement-to-checkout.md §3.3).
 *
 * It used to be inferred instead — « the stay has started and nobody collected, so it will be taken
 * at the door ». The inference was right in the common case and infuriating in every other: it moved
 * the money between headings on its own, on the arrival day, and there was no way to put it back
 * (arbitré avec Adrien le 2026-08-22). The day-of-operations alerts keep that reading, because
 * « what is still to collect today » really is a matter of fact — see utils/operationalCollection.js.
 *
 * Pure: no DB, no clock. The split never changes a total — `arrival + duringStay + endOfStay` always
 * equals what the three inputs sum to (rule 6).
 */


/**
 * @param {object} params
 * @param {number} params.complementAmount         arrival complement (stored).
 * @param {number|boolean} params.complementPaid   collected at check-in.
 * @param {number} params.midStaySettledTotal      sold during the stay AND collected (notes).
 * @param {number} params.endOfStayComplementTotal SAS lines + mid-stay remainder.
 * @param {boolean} params.deferred                the operator moved the arrival complement to the
 *                 door (`complementDeferredToCheckout`).
 * @param {boolean} [params.filedAtEndOfStay]      the row-aware reading when the caller has the stored row
 *                 (`isComplementDeferred`, through the block's `checkoutComplement.deferred`): it decides alone, so
 *                 a complement settled together with the end of stay, or at a 0 € end of stay, stays filed at
 *                 the end of stay as the ledger and the stored summary file it (rule 4, revision 2026-11-08).
 * @returns {{ arrival: number, duringStay: number, endOfStay: number }}
 */
function splitComplementBuckets({
  complementAmount, complementPaid, midStaySettledTotal, endOfStayComplementTotal, deferred, filedAtEndOfStay,
} = {}) {
  const arrival = round2(complementAmount);
  const endOfStay = round2(endOfStayComplementTotal);
  // Money already in the till was collected at check-in, whatever the marker says afterwards.
  const collectedAtArrival = typeof filedAtEndOfStay === 'boolean'
    ? !filedAtEndOfStay
    : Number(complementPaid || 0) === 1 || !deferred;
  return {
    arrival: collectedAtArrival ? arrival : 0,
    duringStay: round2(midStaySettledTotal),
    endOfStay: collectedAtArrival ? endOfStay : round2(endOfStay + arrival),
  };
}


const flag = (v) => Number(v || 0) === 1;
const complementSettled = (row) => flag(row && row.complementPaid) || flag(row && row.complementPaidCash);
const endOfStaySettled = (row) => flag(row && row.endOfStayComplementPaid) || flag(row && row.endOfStayComplementPaidCash);
const day = (v) => String(v || '').slice(0, 10);

// Rule 24 (audit R29-DB-1) — an end of stay with nothing to collect, never settled: trivially settled, as `paid` reads it.
const nothingAtEndOfStay = (row) => round2(row.endOfStayComplementAmount) === 0 && !endOfStaySettled(row);

/**
 * Rule 8 (audit R28 verification V1) — the arrival complement and the end of stay settled by ONE collection: both
 * paid, same date, same caisse flag. That is what the merged card's own mark writes, so the card stays merged.
 * Rule 24 — at 0 € of end of stay, the merged card's mark settled the arrival part alone: still that one collection.
 * Rule 27 — a « paiement unique » is written, never derived: one naming one bucket and not the other is another collection.
 */
function settledTogether(row) {
  const r = row || {};
  if (!complementSettled(r)) return false;
  if (nothingAtEndOfStay(r)) return true;
  const group = parseGroup(r.arrivalPaymentGroup);
  const inGroup = (bucket) => Boolean(group && group.buckets.includes(bucket));
  return endOfStaySettled(r)
    && day(r.complementPaidDate) === day(r.endOfStayComplementPaidDate)
    && flag(r.complementPaidCash) === flag(r.endOfStayComplementPaidCash)
    && inGroup('complement') === inGroup('endOfStayComplement');
}

/** Rule 22 — an end of stay collected on its own (not with the arrival part): it keeps its own card and columns. */
const endOfStaySettledApart = (row) => endOfStaySettled(row) && !settledTogether(row);

/**
 * Rule 6 as every reader applies it (§3.2 edge cases, audit R28-C-M1 and its verification V1): the arrival complement
 * is merged into the end of stay while it is still to collect, or once both were settled together (rule 24: an end of
 * stay at 0 € included). Paid apart, or an arrival part at 0 €, the deferral marker merges nothing.
 * @param {object} row            carries the deferral marker and the complement / end-of-stay payment columns.
 * @param {number} [arrivalAmount] the arrival complement when it differs from the stored column (live quote).
 */
function isComplementDeferred(row, arrivalAmount) {
  const r = row || {};
  return flag(r.complementDeferredToCheckout)
    && round2(arrivalAmount === undefined ? r.complementAmount : arrivalAmount) > 0
    && (!complementSettled(r) || settledTogether(r));
}

/**
 * Rule 22 — the end-of-stay part the merged card holds: one settled apart keeps its own card and its stored columns,
 * so a mark never re-dates nor clears it; one settled together stays on the merged card.
 */
function mergedEndOfStayAmount(row, endOfStayAmount) {
  if (endOfStaySettledApart(row)) return 0;
  return round2(endOfStayAmount === undefined ? (row || {}).endOfStayComplementAmount : endOfStayAmount);
}

/** Whether a mark, un-mark or caisse switch of the arrival complement also writes the end-of-stay columns (rules 8, 22). */
const markCarriesEndOfStay = (row) => isComplementDeferred(row) && mergedEndOfStayAmount(row) > 0;

function readInComplement({
  finalOptionLines, resourceLines, extraGuestComplementSurcharge, midStayForced,
}) {

  // Per-item routing (spec force-item-to-complement.md): forced lines + a forced-to-complément
  // tax don't participate in the pre-arrival deposit/balance split — they live exclusively in
  // the Complément bucket. Forced lines that are also `offered` contribute 0 in both buckets.
  const forcedItemsTotal = roundMoney(
    [...finalOptionLines, ...resourceLines].reduce(
      (sum, line) => sum + (Number(line.inComplement || 0) ? Number(line.totalPrice || 0) : 0),
      0,
    )
    + extraGuestComplementSurcharge,
  );
  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.3 — the mid-stay part leaves BOTH the
  // pre-arrival split (its unforced share) and the arrival complement (its forced share). Everything
  // below reduces to the former formulas when nothing was sold mid-stay (`midStay* = 0`).
  const complementForcedItemsTotal = roundMoney(Math.max(0, forcedItemsTotal - midStayForced));
  return { forcedItemsTotal, complementForcedItemsTotal };
}


function planSettlement({
  lines: {
    finalOptionLines, resourceLines, midStayExtras, extraGuestComplementSurcharge, extraGuestComplementCount,
  },
  stayLevel: {
    resolvedComplementAmount, taxInComplement, isTouristTaxCollectedOnArrival, isTouristTaxForcedToComplement,
    midStaySettledAll, endOfStayComplementTotal,
  },
  receipts: { complementPaid, complementCollected, complementDeferredToCheckout },
}) {

  // Itemisation LIVE du complément d'arrivée (specs/defer-arrival-complement-to-checkout.md §3.2
  // rule 7bis) — la carte fusionnée rend la fiche telle qu'elle est en cours d'édition, donc son
  // détail doit sortir du moteur, pas de la ligne stockée du dernier enregistrement. Même contrat que
  // `buildArrivalComplementDetail` : chaque ligne « en complément » à sa part ARRIVÉE (la part vendue
  // en séjour est facturée au départ, on la retire clé par clé), la taxe quand elle est routée ici,
  // et un reliquat qui referme l'écart avec le montant résolu.
  const complementDetailLines = [];
  {
    const midStayLeft = { ...(midStayExtras.byKey || {}) };
    for (const line of [...finalOptionLines, ...resourceLines]) {
      if (!Number(line.inComplement || 0)) continue;
      if (Number(line.offered || 0) === 1 || line.offered === true) continue;
      const full = roundMoney(line.totalPrice);
      if (full <= 0) continue;
      const key = extraLineKey(line);
      const moved = key ? Math.min(full, roundMoney(Number(midStayLeft[key] || 0))) : 0;
      if (moved > 0) midStayLeft[key] = roundMoney(midStayLeft[key] - moved);
      const amount = roundMoney(full - moved);
      if (amount <= 0) continue;
      complementDetailLines.push({
        kind: line.resourceId != null ? 'resource' : 'option',
        label: String(line.title || line.name || 'Extra').trim(),
        qty: Number(line.billedUnits || line.quantity || 1),
        unitPrice: roundMoney(line.unitPrice),
        amount,
      });
    }
    if (extraGuestComplementSurcharge > 0) {
      complementDetailLines.push({
        kind: 'extraGuests',
        label: 'Voyageurs ajoutés',
        qty: extraGuestComplementCount,
        unitPrice: roundMoney(extraGuestComplementSurcharge / extraGuestComplementCount),
        amount: extraGuestComplementSurcharge,
      });
    }
    if (taxInComplement > 0) {
      const isAddition = !isTouristTaxCollectedOnArrival && !isTouristTaxForcedToComplement;
      complementDetailLines.push({
        kind: 'tax',
        label: isAddition ? ADDED_GUESTS_TAX_LABEL : 'Taxe de séjour',
        qty: 1,
        unitPrice: roundMoney(taxInComplement),
        amount: roundMoney(taxInComplement),
        ...(isAddition ? { addedGuests: true } : {}),
      });
    }
    const listed = roundMoney(complementDetailLines.reduce((sum, l) => sum + l.amount, 0));
    const rem = roundMoney(resolvedComplementAmount - listed);
    if (rem > 0.01) {
      complementDetailLines.push({ kind: 'remainder', label: "Complément d'arrivée", qty: 1, unitPrice: rem, amount: rem });
    }
  }
  // specs/complement-buckets-by-moment.md — the same three amounts, filed under the MOMENT they are
  // collected rather than the column that stores them: an arrival complement left unsettled once the
  // guest is in is taken at the door, so it reads under « fin de séjour ». Presentation-only: the
  // three buckets always sum to the same total.
  const complementSplit = splitComplementBuckets({
    complementAmount: resolvedComplementAmount,
    complementPaid: complementPaid !== undefined ? complementPaid : complementCollected,
    midStaySettledTotal: midStaySettledAll,
    endOfStayComplementTotal,
    deferred: Boolean(complementDeferredToCheckout),
  });
  return { complementDetailLines, complementSplit };
}


// A platform stay never carries a direct payment (payment-link-lifecycle rule 57, audit R9-M1): the platform collects the stay, so a
// link would ask the guest to pay twice. `ownChannel` is the stay's own channel (`saleChannel`); a devis converted into a stay answers
// for both. Pure: the caller reads the rows.
const PLATFORM_RESERVATION = Object.freeze({ httpStatus: 409, error: 'PLATFORM_RESERVATION', message: 'Réservation plateforme : aucun lien de paiement.' });

function linkAllowed({ ownChannel, convertedOwnChannel = true }) {
  return ownChannel && convertedOwnChannel ? null : { ...PLATFORM_RESERVATION };
}

module.exports = {
  PLATFORM_RESERVATION,
  linkAllowed,
  MID_STAY_SOURCE,
  ARRIVAL_COMPLEMENT_EXCESS_KEY,
  ARRIVAL_COMPLEMENT_EXCESS_LABEL,
  extraLineKey,
  buildExtrasBaseline,
  baselineWithDerivedLines,
  splitMidStayExtras,
  splitFromStoredLines,
  resolveMidStaySplit,
  buildMidStayLine,
  parseNotes,
  parseDetail,
  settledByKey,
  notesTotal,
  nextNoteId,
  mergeMidStayIntoDetail,
  sasDetailAmount,
  sasDetailAmountAuto,
  storedMidStayLines,
  parseBaseline,
  splitComplementBuckets,
  flag,
  complementSettled,
  endOfStaySettled,
  settledTogether,
  endOfStaySettledApart,
  isComplementDeferred,
  mergedEndOfStayAmount,
  markCarriesEndOfStay,
  readInComplement,
  planSettlement,
};
