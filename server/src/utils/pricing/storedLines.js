/**
 * STORED LINES — the readers of what a reservation stores about its extra lines (specs/pricing/pricing-components.md §3 rules 2, 72).
 *
 * Contract: `extraLineKey(line)` is the stable key of an extra line (`opt:<id>`, `res:<id>`, `custom:<label>`; a later sale of one article
 * carries its own `lineKey` = `line:<table>:<lineId>`, rule 85, and that is the key — see `lineKeys.js`);
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
  if (line.lineKey) return String(line.lineKey);
  if (line.isCustom || line.customKey != null || line.customOptionId != null) {
    const label = String(line.title || line.description || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return label ? `custom:${label}` : null;
  }
  if (line.optionId != null) return `opt:${Number(line.optionId)}`;
  if (line.resourceId != null) return `res:${Number(line.resourceId)}`;
  return null;
}

/**
 * « Notes en séjour » register (specs/sas/mid-stay-notes.md §3.1) — the history of what was actually
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

/**
 * Rule 94 (and rule 102, loop t2 N-4) — a custom line has no article: it is named by its label. A NEW custom line whose label the stay already
 * holds takes a numbered one (« Bière locale (2) », then « (3) ») on every writer — the sale, the arrival SAS, the fiche — so its payment, its
 * discount and its removal stay its own. `takenKeys`: the `extraLineKey`s the stay's other custom lines hold.
 */
function numberedLabel(label, takenKeys) {
  const keyOf = (text) => extraLineKey({ isCustom: true, description: text });
  let candidate = label;
  for (let n = 2; takenKeys.has(keyOf(candidate)); n += 1) candidate = `${label} (${n})`;
  return candidate;
}

/**
 * Rule 94 (loop t14 S14-1/S14-2, loop t15 S15-3/S15-4, loop t16 S16-3 a) — the one numbering of repeated free labels, shared by the fiche's
 * save, its preview, the creation and the devis writes: a line `kept(index)` names (a stored line, matched) keeps its label; every other line
 * whose label is already taken is numbered. A line the engine drops — a blank label, or no amount (0 €, negative) — is left as it is and takes
 * no label: numbering it would price a « (2) » line, and counting it would number the only line the stay keeps.
 */
// THE rule of a posted free line the engine prices: a label and an amount of at least a cent. A blank or 0 € (or negative) line is no line —
// the quote drops it, the numbering skips it, it names no stored row (`matchStoredCustomLines`), so every judge of a save, its preview and
// its writer agree (pricing-components rule 79 / 94 readings, loop t17 O-V17-1). The one copy of this rule: every filter of the concept reads it.
function isPricedCustomLine(line) {
  return Boolean(String((line && line.description) || '').trim()) && Math.round(Number((line && line.amount) || 0) * 100) > 0;
}

function numberRepeatedCustomLines(customOptions, kept = () => false) {
  if (!Array.isArray(customOptions)) return customOptions;
  const keyOf = (text) => extraLineKey({ isCustom: true, description: text });
  const dropped = (line) => !isPricedCustomLine(line);
  const taken = new Set(customOptions.filter((line, index) => kept(index) && !dropped(line)).map((line) => keyOf(line.description)));
  return customOptions.map((line, index) => {
    if (kept(index) || dropped(line)) return line;
    const description = numberedLabel(String(line.description).trim(), taken);
    taken.add(keyOf(description));
    return description === line.description ? line : { ...line, description };
  });
}

module.exports = {
  extraLineKey, parseNotes, settledByKey, parseDetail, numberedLabel, numberRepeatedCustomLines, isPricedCustomLine,
};
