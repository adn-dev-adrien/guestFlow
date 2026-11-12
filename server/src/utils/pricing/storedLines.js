/**
 * STORED LINES — the readers of what a reservation stores about its extra lines (specs/pricing-components.md §3 rules 2, 72).
 *
 * Contract: `extraLineKey(line)` is the stable key of an extra line (`opt:<id>`, `res:<id>`, `custom:<label>`);
 * `parseNotes(raw)` and `parseDetail(raw)` read the stored JSON of the in-stay notes and of the end-of-stay detail, as an
 * array whatever was stored; `settledByKey(notesRaw)` is the amount collected per line key across the notes.
 *
 * The code moved from `settlement.js` as it was, so SETTLEMENT and REFUNDS (which may import only money, vat, platformPayment
 * and these parsers, rule 72) read the stored format through one module. Pure: no DB, no clock, no settings; imports nothing.
 */

const { roundMoneyOrZero: round2 } = require('./money');

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

function parseDetail(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

module.exports = { extraLineKey, parseNotes, settledByKey, parseDetail };
