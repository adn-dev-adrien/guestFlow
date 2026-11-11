/**
 * TOURIST TAX — the taxe de séjour of a stay (specs/pricing-components.md §3 rules 1, 2, 3, 6).
 *
 * Contract: `computeTouristTaxBreakdown({...})` prices the tax from the property's mode (per person per night, a
 * percentage of the accommodation, a fixed amount), the party, the nights and the accommodation base, and phrases its
 * own caption; `resolveAddedGuestsTouristTax({...})` is the tax of the guests added after what a platform billed.
 * The French money / percentage formatters it phrases with are exported for the captions of the same quote.
 *
 * Pure: no DB, no clock, no settings; knows nothing of extras or payments. Whether a platform collects or remits the
 * tax is read from the platform table by `isPlatformCollectingTouristTax` / `isTouristTaxRemittedByOwner`, which stay
 * in pricing.js until the loader owns that read.
 */
const { roundMoney } = require('./money');

function computeTouristTaxBreakdown({
  touristTaxMode,
  touristTaxPerDayPerPerson,
  touristTaxPercentage,
  touristTaxDepartmentPercentage,
  touristTaxFixedAmount,
  nights,
  adults,
  occupants,
  accommodationAmountTtc,
  accommodationVatRate,
  // specs/tourist-tax-matches-the-office-calculation.md rule 12 — a FROZEN tax carries the base it
  // was computed on, already HT. Given it, the breakdown starts from that figure instead of
  // re-deriving one from today's tariff: it is what makes the frozen line reproduce its own amount
  // in the office's form, which a recomputed base stopped doing on 2026-08-20.
  accommodationAmountHt,
}) {
  const mode = String(touristTaxMode || 'per_day_per_person');
  const nightsCount = Math.max(0, Number(nights || 0));
  const adultsCount = Math.max(0, Number(adults || 0));
  const occupantsCount = Math.max(0, Number(occupants || 0));

  const perDayRate = Math.max(0, Number(touristTaxPerDayPerPerson || 0));
  const communePercentage = Math.max(0, Number(touristTaxPercentage || 0));
  const departmentPercentage = Math.max(0, Number(touristTaxDepartmentPercentage || 0));
  const fixedAmount = Math.max(0, Number(touristTaxFixedAmount || 0));

  const accommodationReferenceTtc = Math.max(0, Number(accommodationAmountTtc || 0));
  const vatRate = Math.max(0, Number(accommodationVatRate || 0));
  const vatDivisor = 1 + (vatRate / 100);

  // `Number(null)` is 0 and passes isFinite, so the null check has to come FIRST: a legacy frozen row
  // carries no base, and reading one as « 0 € » would declare a 0 € tax.
  const frozenBaseHt = accommodationAmountHt != null && Number.isFinite(Number(accommodationAmountHt))
    ? Math.max(0, Number(accommodationAmountHt))
    : null;
  const averageNightPriceHt = frozenBaseHt != null
    ? (nightsCount > 0 ? roundMoney(frozenBaseHt / nightsCount) : 0)
    : (vatDivisor > 0
      ? roundMoney(roundMoney(nightsCount > 0 ? accommodationReferenceTtc / nightsCount : 0) / vatDivisor)
      : roundMoney(nightsCount > 0 ? accommodationReferenceTtc / nightsCount : 0));
  const averageNightPriceTtc = frozenBaseHt != null
    ? roundMoney(averageNightPriceHt * vatDivisor)
    : (nightsCount > 0 ? roundMoney(accommodationReferenceTtc / nightsCount) : 0);
  const perOccupantNightPriceHt = occupantsCount > 0
    ? roundMoney(averageNightPriceHt / occupantsCount)
    : 0;

  // The figure the operator retypes into the commune's form, defined ONCE so the caption and the
  // quote field can never disagree. A frozen base is returned verbatim: rebuilding it from the
  // rounded nightly price drifts by a cent, and what is shown must be what was stored.
  const stayBaseHt = frozenBaseHt != null ? roundMoney(frozenBaseHt) : roundMoney(averageNightPriceHt * nightsCount);

  let touristTaxRate = 0;
  let touristTaxUnitAmount = 0;
  let municipalUnitAmount = 0;
  let departmentUnitAmount = 0;
  let touristTaxTotal = 0;
  let touristTaxLabel = '';

  if (mode === 'per_day_per_person') {
    touristTaxRate = perDayRate;
    touristTaxUnitAmount = perDayRate;
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nightsCount * adultsCount);
    touristTaxLabel = `${frenchEuros(touristTaxUnitAmount)} × ${adultsCount} adulte${adultsCount > 1 ? 's' : ''} × ${nightsCount} nuit${nightsCount > 1 ? 's' : ''}`;
  } else if (mode === 'percentage_accommodation' || mode === 'percentage_and_fixed') {
    touristTaxRate = communePercentage;
    municipalUnitAmount = roundMoney(perOccupantNightPriceHt * (communePercentage / 100));
    departmentUnitAmount = roundMoney(municipalUnitAmount * (departmentPercentage / 100));
    touristTaxUnitAmount = roundMoney(municipalUnitAmount + departmentUnitAmount);
    if (mode === 'percentage_and_fixed') {
      touristTaxUnitAmount = roundMoney(touristTaxUnitAmount + fixedAmount);
    }
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nightsCount * adultsCount);
    const fixedLabel = mode === 'percentage_and_fixed' && fixedAmount > 0
      ? ` + ${frenchEuros(fixedAmount)}`
      : '';
    // specs/tourist-tax-matches-the-office-calculation.md rule 15 — the caption opens on the stay's
    // whole base HT because that is the single figure the office's form asks for (« Montant du séjour
    // HT »). The operator retypes it and lands on the amount shown beside it; the per-night and
    // per-occupant steps follow so the arithmetic can be checked without a calculator. Exactly the
    // spec's shape, French-formatted: an intermediate « = X € HT/nuit » used to print the per-NIGHT
    // price after dividing by the occupants, which no division of the shown figures produces.
    touristTaxLabel = `(${frenchEuros(stayBaseHt)} HT ÷ ${nightsCount} nuit${nightsCount > 1 ? 's' : ''} ÷ ${occupantsCount || 0} occupant${occupantsCount > 1 ? 's' : ''}) × ${frenchPercent(communePercentage)} + ${frenchPercent(departmentPercentage)} dep${fixedLabel} = ${frenchEuros(touristTaxUnitAmount)}/adulte/nuit`;
  }

  return {
    touristTaxMode: mode,
    touristTaxRate,
    touristTaxUnitAmount,
    touristTaxPercentage: communePercentage,
    touristTaxDepartmentPercentage: departmentPercentage,
    touristTaxFixedAmount: fixedAmount,
    touristTaxPricePerNight: averageNightPriceTtc,
    touristTaxPricePerNightHt: averageNightPriceHt,
    // The stay's whole base HT — what the office's « Montant du séjour HT » field wants (rule 12).
    touristTaxBaseHt: stayBaseHt,
    touristTaxPerOccupantNightPriceHt: perOccupantNightPriceHt,
    touristTaxMunicipalUnitAmount: municipalUnitAmount,
    touristTaxDepartmentUnitAmount: departmentUnitAmount,
    touristTaxAdultsCount: adultsCount,
    touristTaxOccupantsCount: occupantsCount,
    touristTaxNights: nightsCount,
    touristTaxLabel,
    touristTaxTotal,
  };
}

// French money / percentage for the server-phrased captions (« 1 234,56 € », « 5,00 % »).
const NBSP = '\u00a0';

function frenchNumber(value) {
  const n = roundMoney(Number(value || 0));
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)},${dec}`;
}

const frenchEuros = (value) => `${frenchNumber(value)}${NBSP}€`;

const frenchPercent = (value) => `${frenchNumber(value)}${NBSP}%`;

// specs/platform-added-guests-tourist-tax.md rules 2, 4 — the tax of the current party against the tax
// of the party the platform billed, both from the engine on the same base: the platform's own figure
// stays out of it, so a platform rate that differs from ours never bills an unchanged party.
function resolveAddedGuestsTouristTax({ adults, occupants, paidAdults, paidOccupants, nights, ...taxInputs }) {
  const taxOf = (adultsCount, occupantsCount) => computeTouristTaxBreakdown({
    ...taxInputs, nights, adults: adultsCount, occupants: occupantsCount,
  }).touristTaxTotal;
  const paidTotal = taxOf(paidAdults, paidOccupants);
  const added = Math.max(0, roundMoney(taxOf(adults, occupants) - paidTotal));
  // The unit amount of a percentage property is rounded to the cent: a gap that small is not a sale.
  const isRoundingNoise = String(taxInputs.touristTaxMode || '').startsWith('percentage')
    && added <= roundMoney(0.01 * Number(nights || 0) * Number(adults || 0));
  return { paidTotal, added: isRoundingNoise ? 0 : added };
}

module.exports = {
  computeTouristTaxBreakdown,
  NBSP,
  frenchNumber,
  frenchEuros,
  frenchPercent,
  resolveAddedGuestsTouristTax,
};
