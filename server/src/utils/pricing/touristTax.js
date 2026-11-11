/**
 * TOURIST TAX — the taxe de séjour of a stay (specs/pricing-components.md §3 rules 1, 2, 3, 6).
 *
 * Contract: `computeTouristTaxBreakdown({...})` prices the tax from the property's mode (per person per night, a
 * percentage of the accommodation, a fixed amount), the party, the nights and the accommodation base, and phrases its
 * own caption; `resolveAddedGuestsTouristTax({...})` is the tax of the guests added after what a platform billed.
 * The French money / percentage formatters it phrases with are exported for the captions of the same quote.
 * `resolveTaxBase({...})` derives the base the tax is computed on (the accommodation paid, less the services the rate
 * already covers and the extra-guest surcharge of a platform brut); `sumIncludedServicesDeduction(lines)` is the value of
 * those services, from lines whose `units` the caller resolved.
 *
 * Pure: no DB, no clock, no settings; knows nothing of extras or payments. Whether a platform collects or remits the
 * tax is decided here from the platform's stored mode (`platformCollectsTouristTax`, `touristTaxRemittedByOwner`); the
 * platform row itself is read by the loader (`models/pricingInputModel.js`).
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

// specs/pricing-components.md §3 rule 50 — the settings of this unit, read through SettingsProvider.for('touristTax', scope).
// `cap` and `exemptions` have no value hard-coded today: no cap, no exemption.
const TOURIST_TAX_MODES = ['per_day_per_person', 'percentage_accommodation', 'percentage_and_fixed'];
const taxAmount = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? null : 'Un nombre positif ou nul est attendu.');
const settingsSchema = [
  { key: 'mode', type: 'string', default: 'per_day_per_person', scope: 'property', validate: (value) => (TOURIST_TAX_MODES.includes(value) ? null : 'Choix invalide.') },
  { key: 'perPersonNight', type: 'number', default: 0, scope: 'property', validate: taxAmount },
  { key: 'percentage', type: 'number', default: 0, scope: 'property', validate: taxAmount },
  { key: 'departmentPercentage', type: 'number', default: 0, scope: 'property', validate: taxAmount },
  { key: 'fixedAmount', type: 'number', default: 0, scope: 'property', validate: taxAmount },
  { key: 'cap', type: 'number', default: null, scope: 'property', validate: (value) => (value === null || taxAmount(value) === null ? null : 'Un nombre positif ou nul est attendu.') },
  { key: 'exemptions', type: 'array', default: [], scope: 'property', validate: (value) => (Array.isArray(value) ? null : 'Une liste est attendue.') },
  {
    key: 'collector', type: 'object', default: null, scope: 'property',
    validate: (value) => (value === null || (value && typeof value.chargedByPlatform === 'boolean' && typeof value.remittedByOwner === 'boolean') ? null : 'Collecteur invalide.'),
  },
];

// "Does the platform charge the tourist tax to the guest?" (i.e. it's not billed by us on the quote).
//   - direct        → false (owner charges it).
//   - non-direct    → the platform's GLOBAL `collectsTouristTax`; missing platform row → default true
//                     (legacy "non-direct = platform collects" safe fallback).
// `row` is `{ c, r }` of the platform's stored mode, read by the loader.
function platformCollectsTouristTax(platformKey, row) {
  if (!platformKey || platformKey === 'direct') return false;
  if (!row) return true; // legacy default: non-direct platforms are assumed to collect.
  return Number(row.c) !== 0;
}

// "Do WE remit the tourist tax to the commune?" — drives the « Taxe de séjour » page + the 46710000
// accounting line. Orthogonal to who charges the guest.
//   - direct        → true (we collect + remit).
//   - non-direct    → we remit iff the platform's GLOBAL `touristTaxRemittedByPlatform = 0` (the
//                     platform reverses it to us, OR we collect at arrival). Missing platform row →
//                     false (legacy "platform handles everything", hidden from the page).
function touristTaxRemittedByOwner(platformKey, row) {
  if (!platformKey || platformKey === 'direct') return true;
  if (!row) return false; // legacy default: ad-hoc non-direct platforms are assumed to remit themselves.
  return Number(row.r) === 0;
}

// specs/tourist-tax-included-services-deduction.md rule 3 — the reference value of the services the
// night rate already covers, which leaves the tourist-tax base. `referencePersons` is the guests the
// RATE includes (`basePriceIncludedGuests`), never the real party: that is what makes the deduction a
// per-stay FORFAIT, so the declared base no longer shrinks as the group grows.
//
// Named rather than inlined because it is the rule, not a detail: the « Suivi taxe de séjour » page
// declares the very same figure by replaying this whole engine (rule 14), so this formula has exactly
// one home. Lines are `{ unitPrice, units }` — the caller owns the filtering and the units each line bills
// for the reference persons and the nights.
function sumIncludedServicesDeduction(lines) {
  return roundMoney((lines || []).reduce((sum, line) => {
    if (!line) return sum;
    return sum + (Number(line.unitPrice || 0) * line.units);
  }, 0));
}

// The base the tax is computed on, from the accommodation paid and what the rate already covers (specs/tourist-tax-matches-the-office-calculation.md).
function resolveTaxBase({
  platformGrossPin, preArrivalOptionsResources, withheldTouristTaxInBrut, taxBaseBeforeDeduction,
  touristTaxIncludedInRateDeduction, extraGuestInBrutSurcharge,
}) {
  // specs/tourist-tax-matches-the-office-calculation.md rules 1-7 — the office asks for the
  // accommodation the guest paid, « hors options et ménage ». Where that figure lives depends on who
  // took the money:
  //   - a platform booking with a brut → the brut IS what the guest paid, so the accommodation is
  //     what remains once the extras billed THROUGH the platform are taken out (rule 2). A line
  //     routed to « Complément » is collected by us at arrival and was never inside the brut, so
  //     subtracting it would deduct it twice;
  //   - anything else → the tariff, which is what the guest paid us directly (rule 3).
  // Then, on both branches alike: the services sold inside the night rate come out (rule 5, the
  // office's « hors ménage »), and so does the extra-guest surcharge (rule 4, operator decision of
  // 2026-09-01 — it is inside the brut, hence subtracted rather than merely not added).
  // This repeals rule 2 of tourist-tax-base-accommodation-only.md: the brut derives the base again.
  // specs/platform-tourist-tax-out-of-the-commission.md rule 6bis — a tax-inclusive brut must not
  // inflate the base the tax itself is computed on. Invisible on a per_day_per_person property (the
  // base doesn't drive the amount) but a tax on the tax on a percentage_accommodation one.
  const taxAccommodationPaid = platformGrossPin != null
    ? roundMoney(Math.max(0, platformGrossPin - preArrivalOptionsResources - withheldTouristTaxInBrut))
    : taxBaseBeforeDeduction;
  const taxBaseAccommodation = roundMoney(Math.max(
    0,
    taxAccommodationPaid
      - touristTaxIncludedInRateDeduction
      - (platformGrossPin != null ? extraGuestInBrutSurcharge : 0),
  ));
  // Rule 16 — a brut that does not even cover the extras billed alongside it is an inconsistent
  // entry, not a zero-euro stay. Floored above, surfaced on the fiche rather than swallowed.
  // platform-tourist-tax-out-of-the-commission.md rule 16 — a withheld tax is part of what the brut
  // is supposed to contain, so it counts in the threshold: a brut that covers the extras but not the
  // tax it claims to include is just as inconsistent.
  const touristTaxBrutInconsistent = platformGrossPin != null
    && platformGrossPin < roundMoney(preArrivalOptionsResources + extraGuestInBrutSurcharge + withheldTouristTaxInBrut);
  return { taxAccommodationPaid, taxBaseAccommodation, touristTaxBrutInconsistent };
}

module.exports = {
  sumIncludedServicesDeduction,
  resolveTaxBase,
  computeTouristTaxBreakdown,
  platformCollectsTouristTax,
  touristTaxRemittedByOwner,
  NBSP,
  frenchNumber,
  frenchEuros,
  frenchPercent,
  resolveAddedGuestsTouristTax,
  settingsSchema,
};
