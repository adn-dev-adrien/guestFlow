/**
 * LEGACY COLLECT-AT — the moment a stored line is collected, derived from what the stay stores today
 * (specs/pricing-components.md §3 rules 36, 37, §5 « Backfill »).
 *
 * Before rule 37 a line carried only `inComplement`; the moment was implied by it and by the stay. This unit reads that
 * implication once, so the backfill of the `collectAt` column adds a column and rewrites no amount:
 *
 *   inComplement = 1 → 'arrival'; 'departure' when the line is above `arrivalExtrasBaseline` (sold during the stay,
 *                      the mid-stay rule of mid-stay-extras-to-end-of-stay-complement.md)
 *   inComplement = 0 → 'platform' on a platform sale (the line is inside the platform's price), else 'plan'
 *
 * « Above the baseline » is judged on amounts per line key (`extraLineKey`), like `splitMidStayExtras`: two custom lines
 * of the same text are one key, an offered or zero line is never above. Pure: no DB, no clock, no settings.
 *
 *   legacyCollectAt(lines, { platformSale, baseline, collectedMidStayKeys }) → ['arrival' | 'departure' | 'platform' | 'plan', …] in the order of `lines`
 *   `collectedMidStayKeys`: the keys a COLLECTED end-of-stay complement froze (its stored lines and notes; they replace the baseline, rule 91)
 *   `lines` are `{ optionId | resourceId | isCustom + description, totalPrice, offered, inComplement }`; `baseline` is the raw
 *   `arrivalExtrasBaseline` (JSON text or object, or null).
 */
const { roundMoney } = require('./money');
const { extraLineKey } = require('./storedLines');
const { parseBaseline } = require('./settlement');

function keysAboveBaseline(lines, baselineRaw) {
  const baseline = parseBaseline(baselineRaw);
  const above = new Set();
  if (!baseline) return above;
  const totals = new Map();
  for (const line of lines) {
    if (!line || Number(line.offered || 0) === 1) continue;
    const key = extraLineKey(line);
    const total = roundMoney(line.totalPrice);
    if (!key || total <= 0) continue;
    totals.set(key, roundMoney((totals.get(key) || 0) + total));
  }
  for (const [key, total] of totals) if (total > roundMoney(baseline[key])) above.add(key);
  return above;
}

// Rule 91 — once the end-of-stay complement is collected the mid-stay share is FROZEN in its stored lines and notes (the engine reads them,
// `resolveMidStaySplit`): a key they do not hold went to the arrival complement, whatever the baseline says. `collectedMidStayKeys` = those keys.
function legacyCollectAt(lines, { platformSale = false, baseline = null, collectedMidStayKeys = null } = {}) {
  const above = collectedMidStayKeys ? new Set(collectedMidStayKeys) : keysAboveBaseline(lines, baseline);
  return lines.map((line) => {
    if (Number(line.inComplement || 0) === 1) return above.has(extraLineKey(line)) ? 'departure' : 'arrival';
    return platformSale ? 'platform' : 'plan';
  });
}

module.exports = { legacyCollectAt, keysAboveBaseline };
