/**
 * Accounting ventilation of an ADJUSTED arrival complement —
 * specs/adjustable-complement-amounts.md §3.6.
 *
 * An arrival complement is not one accounting line but several: `70600000` (the accommodation
 * auto-gap), `70600010` (options + custom options), `70601000` (resources) and the `46710000`
 * tourist-tax pass-through. When the operator freezes the bucket at the amount he ANNOUNCED to the
 * guest, someone has to say which of those postes absorbs the difference — and that someone is the
 * fiche, never the accounting export (rule 31: the export only ever splits a TTC into HT + VAT).
 *
 * Two postes are untouchable (rule 32):
 *   - the **tourist tax**, which is a debt to the commune, not revenue — moving it would desync the
 *     `46710000` line from the tax declaration;
 *   - the **accommodation** share: reducing the price of the stay is what « Prix hébergement ajusté »
 *     is for, not a complement adjustment.
 *
 * So the adjustment lands on the prestations — options, custom options and resources — pro rata of
 * what they currently weigh. Their floor is therefore `accommodation + tax` (rule 33), which also
 * guarantees the export's tax clamp never bites.
 *
 * Pure: no DB, no clock. Unit-tested in tests/complement-allocation.unit.test.js.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A line of `buildArrivalComplementDetail` → the poste that books it.
const POSTE_BY_KIND = {
  option: 'options',
  resource: 'resources',
  tax: 'tax',
  remainder: 'accommodation',
};

/**
 * Poste split of the complement as the fiche shows it. `autoAmount` is the complement the engine
 * would produce WITHOUT the operator's adjustment: whatever it carries beyond the itemised lines is
 * the accommodation auto-gap.
 *
 * @param {Array}  detailLines `buildArrivalComplementDetail(...).detail`
 * @param {number} autoAmount  the un-adjusted complement amount
 * @returns {{accommodation:number, options:number, resources:number, tax:number}}
 */
function splitComplementByPoste(detailLines, autoAmount) {
  const split = { accommodation: 0, options: 0, resources: 0, tax: 0 };
  for (const line of (detailLines || [])) {
    const poste = POSTE_BY_KIND[line && line.kind];
    if (!poste) continue;
    split[poste] = round2(split[poste] + Number(line.amount || 0));
  }
  // The itemised lines can only under-shoot the total (the remainder line closes the gap), but an
  // adjusted complement is smaller than its own lines — so the accommodation share is derived from
  // the AUTO amount, never from the adjusted one.
  const listed = round2(split.options + split.resources + split.tax);
  split.accommodation = Math.max(0, round2(Number(autoAmount || 0) - listed));
  return split;
}

/**
 * Spread an adjusted complement over its postes.
 *
 * @param {object} params
 * @param {number} params.target        the amount the operator announced.
 * @param {number} params.accommodation auto-gap share (untouched).
 * @param {number} params.options       options + custom options share.
 * @param {number} params.resources     resources share.
 * @param {number} params.tax           tourist tax share (untouched).
 * @returns {{accommodation:number, options:number, resources:number, tax:number,
 *            floor:number, floored:boolean, total:number}}
 */
function allocateComplementAdjustment({ target, accommodation = 0, options = 0, resources = 0, tax = 0 } = {}) {
  const keptAccommodation = Math.max(0, round2(accommodation));
  const keptTax = Math.max(0, round2(tax));
  const floor = round2(keptAccommodation + keptTax);
  const asked = Math.max(0, round2(target));
  const floored = asked < floor;
  const total = floored ? floor : asked;
  const adjustable = round2(total - floor);

  const baseOptions = Math.max(0, round2(options));
  const baseResources = Math.max(0, round2(resources));
  const base = round2(baseOptions + baseResources);

  let nextOptions;
  let nextResources;
  if (base <= 0) {
    // Nothing to spread over: an extra collected on site is a « prestation complémentaire » (rule 35).
    nextOptions = adjustable;
    nextResources = 0;
  } else {
    nextOptions = round2((adjustable * baseOptions) / base);
    nextResources = round2((adjustable * baseResources) / base);
    // The cent of rounding goes to the heavier poste so Σ postes == the announced amount exactly.
    const residue = round2(adjustable - nextOptions - nextResources);
    if (residue !== 0) {
      if (baseOptions >= baseResources) nextOptions = round2(nextOptions + residue);
      else nextResources = round2(nextResources + residue);
    }
  }

  return {
    accommodation: keptAccommodation,
    options: nextOptions,
    resources: nextResources,
    tax: keptTax,
    floor,
    floored,
    total,
  };
}

/**
 * Stored JSON → the three revenue postes (+ the un-adjusted complement, when it was recorded), or
 * `null` when absent/unreadable.
 */
function parseComplementAllocation(raw) {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out = {
    accommodation: round2(parsed.accommodation),
    options: round2(parsed.options),
    resources: round2(parsed.resources),
    // La part taxe de séjour, intouchée mais STOCKÉE : c'est elle qui ferme la somme des crédits
    // sur le montant annoncé, sans laisser l'export rattraper quoi que ce soit (§3.6 règle 37).
    tax: parsed.tax == null ? null : round2(parsed.tax),
    // Le complément AVANT ajustement : dénominateur du gross-up de l'export, sinon un ajustement à
    // la baisse re-gonflerait l'écriture (§3.6 règle 37).
    auto: parsed.auto == null ? null : round2(parsed.auto),
  };
  if (![out.accommodation, out.options, out.resources].every((n) => Number.isFinite(n))) return null;
  return out;
}

module.exports = { splitComplementByPoste, allocateComplementAdjustment, parseComplementAllocation };
