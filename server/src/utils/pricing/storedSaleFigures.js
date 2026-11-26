/**
 * STORED SALE FIGURES — what EXTRA GUESTS and TOURIST TAX gave a stay, kept so a sale reads them as stored
 * (specs/pricing/pricing-components.md §3 rule 8).
 *
 * A stay edit runs the two units and stores what each provided (`reservations.storedExtraGuests`, `storedTouristTax`: the
 * extra-guest supplement and its share inside a platform price, the tax and its whole detail — base, rate, routing, the
 * added guests' part). A sale (`staySale`) reads them instead of running the units: a tariff, a season or a tax setting
 * changed since the stay was priced never moves a stay a line is sold on.
 *
 * Each record carries the `basis` it was computed on: the stay's own inputs of the unit (party, dates, channel, platform
 * price, the frozen tax, what the tax base reads of the lines), never the settings, the tariff, nor what the save writes back
 * from the record itself. A sale whose basis differs —
 * a stay row rewritten by a path that did not price it, a sale that changes what the tax base reads (a platform line, a line
 * included in the rate) — runs the unit as before. So does a stay with no record (a row no save has written since the column).
 *
 * Pure: no DB, no clock, no settings.
 */
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const VERSION = 1;
const SALE_FIGURES = Symbol.for('guestflow.pricing.saleFigures');

const EXTRA_GUESTS_KEYS = Object.freeze([
  'extraGuestCalc', 'extraGuestComplementCount', 'extraGuestComplementOriginal', 'extraGuestComplementSurcharge',
  'extraGuestCount', 'extraGuestInBrutSurcharge', 'extraGuestPriceUnit', 'extraGuestSurcharge',
  'extraGuestSurchargeOriginal', 'extraGuestUnitPrice', 'includedGuests', 'isExtraGuestSurchargeOffered',
  'resolvedPlatformPaidGuests',
]);
const TOURIST_TAX_KEYS = Object.freeze([
  'isTouristTaxCollectedOnArrival', 'isTouristTaxOfferedByPlatform', 'isTouristTaxRemittedByOwnerFlag',
  'resolvedPlatformPaidOccupants', 'reversedTouristTaxInBrut', 'taxAccommodationPaid', 'taxBaseAccommodation',
  'taxBaseBeforeDeduction', 'touristTaxAddedGuestsAdults', 'touristTaxAddedGuestsAmount', 'touristTaxBreakdown',
  'touristTaxBrutInconsistent', 'touristTaxGap', 'touristTaxIncludedInRateDeduction', 'touristTaxReversedByPlatform',
  'touristTaxTotal', 'withheldTouristTaxEntered', 'withheldTouristTaxInBrut',
]);

const orNull = (value) => (value === undefined ? null : value);
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// The stay's own inputs of EXTRA GUESTS (rule 8): the party, the nights, the channel, the platform price and paid guests, the
// offer. The live extra-guest settings, the pricing rules and the tariff the save locks from the record's own figures
// (`tariffSnapshot`) are not in it: that is what is stored.
function extraGuestsBasis(ctx) {
  return digest([
    'extraGuests', VERSION, orNull(ctx.startDate), orNull(ctx.endDate), orNull(ctx.persons), orNull(ctx.platform),
    Boolean(ctx.isDirectBooking), Boolean(ctx.extraGuestSurchargeOffered), orNull(ctx.platformGrossAmountInput),
    orNull(ctx.platformPaidGuests),
  ]);
}

// The stay's own inputs of TOURIST TAX, the lines it reads included (the platform lines of the brut, the lines included in the
// rate): a sale that changes them is priced by the unit, as before. The tax settings and the platform's tax mode are not in it,
// nor what the save itself writes back from the record's figures: the added guests' tax (`touristTaxAddedGuests*`, read only once
// the complement is collected) and the base and divisor behind a frozen tax (`touristTaxFrozenBaseHt` / `Occupants`, rule 12 of
// the tourist-tax spec); the collection and the freeze themselves are in the basis.
function touristTaxBasis(ctx) {
  const includedInRate = (Array.isArray(ctx.finalOptionLines) ? ctx.finalOptionLines : [])
    .filter((line) => line && line.includedInRate)
    .map((line) => [orNull(line.optionId), orNull(line.unitPrice), orNull(line.quantity), orNull(line.priceType)]);
  return digest([
    'touristTax', VERSION, orNull(ctx.startDate), orNull(ctx.endDate), orNull(ctx.nights), orNull(ctx.adults),
    orNull(ctx.children), orNull(ctx.teens), orNull(ctx.persons), orNull(ctx.platform), Boolean(ctx.channel && ctx.channel.namedChannel),
    orNull(ctx.baseAccommodationPrice), orNull(ctx.customFinalPrice), orNull(ctx.normalizedDiscountPercent),
    orNull(ctx.extraGuestInBrutSurcharge), orNull(ctx.includedGuests), orNull(ctx.resolvedPlatformPaidGuests),
    orNull(ctx.platformGrossPin), orNull(ctx.preArrivalOptionsResources), orNull(ctx.platformPaidAdults),
    orNull(ctx.platformPaidOccupants), orNull(ctx.platformTouristTaxAmountInput), Boolean(ctx.touristTaxInComplement), Boolean(ctx.complementPaid),
    orNull(ctx.vatRate), Boolean(ctx.freezeTouristTax), orNull(ctx.frozenTouristTaxTotal), orNull(ctx.frozenTouristTaxRate), includedInRate,
  ]);
}

// A record is kept only when JSON gives back exactly what the unit provided (no undefined, no NaN): else nothing is stored.
function recordOf(ctx, keys, basis) {
  const figures = Object.fromEntries(keys.map((key) => [key, ctx[key]]));
  const copy = JSON.parse(JSON.stringify(figures));
  return isDeepStrictEqual(copy, figures) ? { v: VERSION, basis, figures: copy } : null;
}

/** The two records of a priced context: `{ extraGuests, touristTax }`, each `{ v, basis, figures }` or null. */
function saleFiguresOfContext(ctx) {
  return {
    extraGuests: recordOf(ctx, EXTRA_GUESTS_KEYS, extraGuestsBasis(ctx)),
    touristTax: recordOf(ctx, TOURIST_TAX_KEYS, touristTaxBasis(ctx)),
  };
}

/** The records a quote was priced with (`compose` attaches them), or null. */
const saleFiguresOf = (quote) => (quote && quote[SALE_FIGURES]) || null;

/**
 * The tourist-tax gap of a quote (specs/platforms/platform-host-statement-and-commission-vat.md rule 7): what the platform paid for the tax beyond
 * GuestFlow's own, signed, already inside the accommodation. Read from the tax record, not a key of the quote: the quote's key set is the one
 * every caller and the price gate know.
 */
const touristTaxGapOf = (quote) => {
  const record = saleFiguresOf(quote);
  const gap = record && record.touristTax && record.touristTax.figures ? Number(record.touristTax.figures.touristTaxGap) : 0;
  return Number.isFinite(gap) ? gap : 0;
};

const parse = (raw) => {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    return record && record.v === VERSION && typeof record.basis === 'string' && record.figures && typeof record.figures === 'object' ? record : null;
  } catch { return null; }
};

/** The stored records of a stay row, for a sale's engine input. The tax record must state the tax the row stores, or it is not read. */
function storedSaleFiguresOfRow(row) {
  if (!row) return null;
  const extraGuests = parse(row.storedExtraGuests);
  let touristTax = parse(row.storedTouristTax);
  if (touristTax && Math.round(Number(touristTax.figures.touristTaxTotal || 0) * 100) !== Math.round(Number(row.touristTaxTotal || 0) * 100)) touristTax = null;
  return extraGuests || touristTax ? { extraGuests, touristTax } : null;
}

/** The record of a unit when it was computed on the sale's own basis, else null (the unit then runs). */
function matchingRecord(stored, unit, basis) {
  const record = stored && stored[unit];
  return record && record.basis === basis ? record.figures : null;
}

module.exports = {
  SALE_FIGURES, EXTRA_GUESTS_KEYS, TOURIST_TAX_KEYS, extraGuestsBasis, touristTaxBasis, saleFiguresOfContext, saleFiguresOf, touristTaxGapOf,
  storedSaleFiguresOfRow, matchingRecord,
};
