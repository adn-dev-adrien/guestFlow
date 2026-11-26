/**
 * The option lines of a platform fiche follow the options of its statement, by themselves
 * (specs/platforms/platform-host-statement-and-commission-vat.md rule 2).
 *
 * `adjustOptionLines` compares « Options (relevé) » with the sum of the option and resource lines the platform bills (not
 * offered, not in the complement) and settles the gap on the posted lines, to the cent:
 *   - gap > 0: an OFFERED catalogue line priced exactly at the gap becomes paid; else a catalogue option of the property,
 *     absent from the fiche and priced exactly at the gap, is added; else the custom line `platform_options` carries it;
 *   - gap < 0: the custom line `platform_options` is lowered first (removed at 0); then a PAID platform-billed line priced
 *     exactly at the remaining gap becomes offered; nothing matching → a refusal on the field, the one case it cannot settle.
 * Pure: the caller hands the engine's quote of the posted lines and a `requote(lines)` that prices adjusted ones, which
 * verifies a catalogue choice (a unit price the engine moves by quantity or a lock) before it is kept.
 */
const { roundMoneyStrict: round2, toCents } = require('./pricing/money');
const { isPlatformLine } = require('./pricing/platformPrice');
const { formatEuros } = require('./reservationLedger');

const CUSTOM_KEY = 'platform_options';


const clone = (lines) => ({
  options: (lines.options || []).map((line) => ({ ...line })),
  customOptions: (lines.customOptions || []).map((line) => ({ ...line })),
  offeredOptionIds: (lines.offeredOptionIds || []).map((id) => Number(id)),
});

/** What the platform bills through the lines (options and resources): paid, platform-routed lines only. */
function billedOf(quote) {
  const lines = [...(quote.optionLines || []), ...(quote.resourceLines || [])];
  return round2(lines.filter((line) => line && !line.offered && isPlatformLine(line))
    .reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
}

const isCustomOfKey = (line) => String(line.customKey || '') === CUSTOM_KEY;

/** The posted catalogue entry a quoted line comes from: its own `lineId`, else the first one of its article. */
function postedEntryOf(lines, quoted) {
  const byLine = quoted.lineId != null ? lines.options.find((entry) => entry.lineId != null && Number(entry.lineId) === Number(quoted.lineId)) : null;
  return byLine || lines.options.find((entry) => Number(entry.optionId) === Number(quoted.optionId));
}

function setCatalogueOffered(lines, quoted, offered) {
  const entry = postedEntryOf(lines, quoted);
  // A line that names itself is offered or paid alone: the article-wide list would flip its sisters too.
  if (entry && entry.lineId != null) { entry.offered = offered; return; }
  const id = Number(quoted.optionId);
  const siblings = lines.options.filter((other) => Number(other.optionId) === id && other !== entry);
  const stillOffered = siblings.some((other) => (other.lineId != null && other.offered !== undefined ? Boolean(Number(other.offered)) : lines.offeredOptionIds.includes(id)));
  if (offered) {
    if (!lines.offeredOptionIds.includes(id)) lines.offeredOptionIds.push(id);
  } else if (!stillOffered) {
    lines.offeredOptionIds = lines.offeredOptionIds.filter((other) => other !== id);
  }
}

/**
 * @param {object} p
 * @param {number|null} p.optionsAmount   « Options (relevé) », null/'' when not typed (no adjustment)
 * @param {object} p.quote                the engine's quote of the posted lines (`optionLines`, `resourceLines`)
 * @param {object} p.lines                the posted `{ options, customOptions, offeredOptionIds }`
 * @param {Array}  p.catalogue            the property's options (`id`, `title`, `price`, `priceType`, `autoEnabled`, `isCancellationInsurance`)
 * @param {string} p.platformLabel        « Airbnb », for the custom line
 * @param {Function} p.requote            (lines) → the quote of the adjusted lines
 * @returns {{ ok: true, lines: object, changed: boolean, notes: string[] }
 *   | { ok: false, field: 'platformOptionsAmount', message: string }}
 */
function adjustOptionLines({
  optionsAmount, quote, lines, catalogue = [], platformLabel = '', requote,
}) {
  const unchanged = { ok: true, lines, changed: false, notes: [] };
  if (optionsAmount === '' || optionsAmount == null || !Number.isFinite(Number(optionsAmount))) return unchanged;
  const target = round2(Number(optionsAmount));
  const billed = billedOf(quote);
  const gap = round2(target - billed);
  if (toCents(gap) === 0) return unchanged;

  const refuse = () => ({
    ok: false,
    field: 'platformOptionsAmount',
    message: `Le relevé compte ${formatEuros(target)} d’options, la fiche ${formatEuros(billed)} : retirer une option.`,
  });

  const withCustomLine = (base, delta) => {
    const next = clone(base);
    const label = `Options ${platformLabel}`.trim();
    const index = next.customOptions.findIndex(isCustomOfKey);
    if (index < 0) {
      next.customOptions.push({
        customKey: CUSTOM_KEY, description: label, amount: round2(delta), offered: false, inComplement: 0,
      });
      return { next, note: `« ${label} » ajouté (${formatEuros(delta)}) pour suivre le relevé.` };
    }
    const line = next.customOptions[index];
    // An offered line bills nothing: it carries exactly what is needed, not its offered amount plus the gap.
    const amount = round2((line.offered ? 0 : Number(line.amount || 0)) + delta);
    if (amount <= 0) next.customOptions.splice(index, 1);
    else Object.assign(line, { amount, offered: false, inComplement: 0 });
    return { next, note: `« ${line.description || label} » ${delta > 0 ? 'porté' : 'ramené'} à ${formatEuros(Math.max(0, amount))} pour suivre le relevé.`, rest: amount < 0 ? round2(amount) : 0 };
  };

  const settled = (next, notes) => {
    const verified = typeof requote === 'function' ? requote(next) : null;
    return { next, notes, ok: !verified || toCents(billedOf(verified)) === toCents(target) };
  };

  if (gap > 0) {
    const offered = (quote.optionLines || []).find((line) => line && !line.isCustom && line.offered && isPlatformLine(line)
      && toCents(line.originalTotalPrice) === toCents(gap));
    if (offered) {
      const next = clone(lines);
      setCatalogueOffered(next, offered, false);
      const attempt = settled(next, [`${offered.title} passé en payant (${formatEuros(gap)}) pour suivre le relevé.`]);
      if (attempt.ok) return { ok: true, lines: attempt.next, changed: true, notes: attempt.notes };
    }
    const onFiche = new Set((lines.options || []).map((line) => Number(line.optionId)));
    const absent = catalogue.find((option) => !onFiche.has(Number(option.id))
      && !Number(option.autoEnabled || 0) && !Number(option.isCancellationInsurance || 0)
      && String(option.priceType || 'per_stay') === 'per_stay' && toCents(option.price) === toCents(gap));
    if (absent) {
      const next = clone(lines);
      next.options.push({ optionId: Number(absent.id), quantity: 1, inComplement: 0 });
      const attempt = settled(next, [`${absent.title} ajouté (${formatEuros(gap)}) pour suivre le relevé.`]);
      if (attempt.ok) return { ok: true, lines: attempt.next, changed: true, notes: attempt.notes };
    }
    const { next, note } = withCustomLine(lines, gap);
    return { ok: true, lines: next, changed: true, notes: [note] };
  }

  // gap < 0 — the custom line first.
  let remaining = gap;
  let working = lines;
  const notes = [];
  if ((lines.customOptions || []).some((line) => isCustomOfKey(line) && !line.offered)) {
    const { next, note, rest } = withCustomLine(lines, gap);
    working = next;
    notes.push(note);
    remaining = round2(rest || 0);
    if (remaining === 0) return { ok: true, lines: working, changed: true, notes };
  }
  const paid = (quote.optionLines || []).find((line) => line && !line.isCustom && !line.offered && isPlatformLine(line)
    && toCents(line.totalPrice) === toCents(-remaining));
  if (paid) {
    const next = clone(working);
    setCatalogueOffered(next, paid, true);
    const attempt = settled(next, [...notes, `${paid.title} passé en offert (${formatEuros(-remaining)}) pour suivre le relevé.`]);
    if (attempt.ok) return { ok: true, lines: attempt.next, changed: true, notes: attempt.notes };
  }
  const paidCustom = (working.customOptions || []).find((line) => !isCustomOfKey(line) && !line.offered
    && !Number(line.inComplement || 0) && toCents(line.amount) === toCents(-remaining));
  if (paidCustom) {
    const next = clone(working);
    const target2 = next.customOptions.find((line) => line.customKey === paidCustom.customKey && line.description === paidCustom.description);
    target2.offered = true;
    notes.push(`${paidCustom.description} passé en offert (${formatEuros(-remaining)}) pour suivre le relevé.`);
    return { ok: true, lines: next, changed: true, notes };
  }
  return refuse();
}

module.exports = { adjustOptionLines, billedOf, CUSTOM_KEY };
