/**
 * Public projections (specs/public-api.md §3 rule 5). Pure functions that map internal rows /
 * engine output to the deliberately reduced PUBLIC shape. They are the single place that decides
 * what leaves the building: anything not explicitly copied here is NOT exposed.
 *
 * Deliberately EXCLUDED everywhere: iCal source URLs/tokens, sync status, accounting buckets
 * (acompteContribTtc/soldeContribTtc), payment state, internal notes, VAT-internal net breakdowns,
 * platform attribution on availability, image/document URLs (Q7), tax configuration, deposit
 * percentages.
 */

function toPublicProperty(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    nameArticle: row.nameArticle || null,
    maxAdults: Number(row.maxAdults || 0),
    maxChildren: Number(row.maxChildren || 0),
    maxBabies: Number(row.maxBabies || 0),
    singleBeds: Number(row.singleBeds || 0),
    doubleBeds: Number(row.doubleBeds || 0),
    basePriceIncludedGuests: Number(row.basePriceIncludedGuests || 0),
    defaultCheckIn: row.defaultCheckIn || null,
    defaultCheckOut: row.defaultCheckOut || null,
  };
}

/**
 * Detail = list projection + extraGuestPrice + a "from €X / night" teaser (Q6) computed from the
 * property's active pricing rules. `pricingRules` is the array attached by
 * propertiesModel.getByIdWithDetails. NO image/document URLs (Q7).
 */
function toPublicPropertyDetail(row) {
  if (!row) return null;
  const nightly = (row.pricingRules || [])
    .map((r) => Number(r.pricePerNight))
    .filter((n) => Number.isFinite(n) && n > 0);
  const fromPricePerNight = nightly.length ? Math.min(...nightly) : null;
  return {
    ...toPublicProperty(row),
    extraGuestPrice: Number(row.extraGuestPrice || 0),
    fromPricePerNight,
  };
}

function toPublicOption(row) {
  if (!row) return null;
  const out = {
    id: Number(row.id),
    title: row.title,
    titleEn: row.titleEn || null,
    description: row.description || null,
    priceType: row.priceType,
    price: Number(row.price || 0),
  };
  if (row.autoOptionType) out.autoOptionType = row.autoOptionType;
  if (row.priceType === 'per_participant_progressive' && Array.isArray(row.optionProgressiveTiers) && row.optionProgressiveTiers.length) {
    out.progressiveTiers = row.optionProgressiveTiers;
  }
  return out;
}

/**
 * Public resource projection: only the fields a visitor needs to pick an add-on resource. `price` is
 * the EFFECTIVE per-property price (resolved by resourcesModel.list). Stock/quantity, opening hours,
 * slot config and internal flags are NOT exposed.
 */
function toPublicResource(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    description: row.note || null,
    priceType: row.priceType,
    price: Number(row.price || 0),
  };
}

/**
 * Collapse a sorted array of ISO dates into contiguous inclusive ranges:
 *   ["2026-07-10","2026-07-11","2026-07-12"] → [{ start: "2026-07-10", end: "2026-07-12" }]
 */
function collapseToRanges(sortedDates) {
  const ranges = [];
  for (const date of sortedDates) {
    const last = ranges[ranges.length - 1];
    if (last) {
      const next = new Date(`${last.end}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      if (next.toISOString().slice(0, 10) === date) {
        last.end = date;
        continue;
      }
    }
    ranges.push({ start: date, end: date });
  }
  return ranges;
}

function toPublicAvailability({ propertyId, from, to, blockedDates }) {
  const sorted = Array.from(new Set(blockedDates || [])).filter(Boolean).sort();
  return {
    propertyId: Number(propertyId),
    from,
    to,
    blockedDates: sorted,
    blockedRanges: collapseToRanges(sorted),
  };
}

/**
 * Project the pricing engine output to the public quote. `available` is computed by the controller
 * (range vs blocked dates) and injected. EXCLUDES VAT net breakdowns, accounting buckets, override
 * flags, and resource lines.
 */
function toPublicQuote(quote, { available, startDate, endDate }) {
  return {
    propertyId: Number(quote.property?.id ?? quote.propertyId),
    startDate,
    endDate,
    nights: Number(quote.nights || 0),
    persons: Number(quote.persons || 0),
    available: Boolean(available),
    minNights: Number(quote.requiredMinNights || 0),
    minNightsBreached: Boolean(quote.minNightsBreached),
    currency: 'EUR',
    nightlyBreakdown: (quote.nightlyBreakdown || []).map((n) => ({ date: n.date, price: Number(n.price || 0) })),
    accommodationTotal: Number(quote.totalPrice || 0),
    extraGuestSurcharge: Number(quote.extraGuestSurcharge || 0),
    options: (quote.optionLines || []).map((o) => ({
      optionId: Number(o.optionId),
      title: o.title,
      quantity: Number(o.quantity || 0),
      unitPrice: Number(o.unitPrice || 0),
      total: Number(o.totalPrice || 0),
      offered: Boolean(o.offered),
    })),
    optionsTotal: Number(quote.optionsTotal || 0),
    resources: (quote.resourceLines || []).map((r) => ({
      resourceId: Number(r.resourceId),
      name: r.name,
      quantity: Number(r.quantity || 0),
      unitPrice: Number(r.unitPrice || 0),
      total: Number(r.totalPrice || 0),
      offered: Boolean(r.offered),
    })),
    resourcesTotal: Number(quote.resourcesTotal || 0),
    touristTax: {
      total: Number(quote.touristTaxTotal || 0),
      label: quote.touristTaxLabel || null,
      collectedOnArrival: Boolean(quote.touristTaxCollectedOnArrival),
    },
    finalPrice: Number(quote.finalPrice || 0),
    deposit: { amount: Number(quote.depositAmount || 0), dueDate: quote.depositDueDate || null },
    balance: { amount: Number(quote.balanceAmount || 0), dueDate: quote.balanceDueDate || null },
    complementOnArrival: Number(quote.complementAmount || 0),
  };
}

module.exports = {
  toPublicProperty,
  toPublicPropertyDetail,
  toPublicOption,
  toPublicResource,
  toPublicAvailability,
  toPublicQuote,
  collapseToRanges,
};
