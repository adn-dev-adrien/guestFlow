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

/**
 * Stable key of an extra line, shared by the baseline and the current state.
 * Custom lines have no stable id (they are deleted + re-inserted on every save), so they are keyed
 * by their normalised label — two custom lines sharing a label are aggregated on the same key, on
 * both sides of the comparison.
 * @returns {string|null} null when the line is not a billable extra.
 */
function extraLineKey(line) {
  if (!line) return null;
  if (line.isCustom || line.customKey != null || line.customOptionId != null) {
    const label = String(line.title || line.description || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return label ? `custom:${label}` : null;
  }
  if (line.optionId != null) return `opt:${Number(line.optionId)}`;
  if (line.resourceId != null) return `res:${Number(line.resourceId)}`;
  return null;
}

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
  const baseline = parseBaseline(baselineRaw);
  const settled = settledByKey(notesRaw);
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

/**
 * « Notes en séjour » register (specs/mid-stay-notes.md §3.1) — the history of what was actually
 * COLLECTED during the stay. A note exists only once settled; a sale left for check-out simply stays
 * in the end-of-stay remainder.
 */
function parseNotes(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Σ collected per line key, across every note.
function settledByKey(notesRaw) {
  const byKey = {};
  for (const note of parseNotes(notesRaw)) {
    for (const line of ((note && note.lines) || [])) {
      const key = line && (line.key || extraLineKey(line));
      const amount = round2(line && line.amount);
      if (!key || amount <= 0) continue;
      byKey[key] = round2((byKey[key] || 0) + amount);
    }
  }
  return byKey;
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

function parseDetail(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Sum of the end-of-stay detail lines the departure SAS owns (ménage, linge manquant, extincteur,
// linge de toilette différé…) — i.e. everything except the mid-stay lines this module writes.
function sasDetailAmount(detailRaw) {
  return round2(parseDetail(detailRaw)
    .filter((l) => l && l.source !== MID_STAY_SOURCE)
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

module.exports = {
  MID_STAY_SOURCE,
  extraLineKey,
  buildExtrasBaseline,
  splitMidStayExtras,
  splitFromStoredLines,
  resolveMidStaySplit,
  buildMidStayLine,
  parseNotes,
  settledByKey,
  notesTotal,
  nextNoteId,
  mergeMidStayIntoDetail,
  sasDetailAmount,
  storedMidStayLines,
  parseBaseline,
};
