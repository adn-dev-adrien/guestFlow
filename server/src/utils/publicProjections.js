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
    maxGuests: Number(row.maxGuests || 0),
    maxBabies: Number(row.maxBabies || 0),
    // Deprecated alias of maxGuests (specs/property-capacity-single-total.md §3 rule 11): the
    // manually-deployed gf-seo-* mu-plugins read `maxAdults` as the advertised « capacité ». Drop it
    // once they are redeployed. `maxChildren` is NOT aliased — it has no correct value under the
    // one-total model.
    maxAdults: Number(row.maxGuests || 0),
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

// Human-readable price-basis + quantity labels for the site — computed SERVER-SIDE from priceType +
// showsPlanningCard so it is the single source of truth: adding an option needs NO website change, the
// plugin just renders these strings (specs/public-planning-options.md). A planning-card option is
// billed by SÉANCE on the site (the visitor's quantity = number of sessions), so its labels differ
// from the back-office occurrence model.
function optionPriceLabels(priceType, showsPlanningCard) {
  const pt = String(priceType || '');
  const perPerson = pt.indexOf('per_person') === 0;
  if (showsPlanningCard) {
    return {
      priceUnitLabel: perPerson ? 'par personne et par séance' : 'par séance',
      quantityLabel: 'Nombre de séances',
    };
  }
  const MAP = {
    per_person: 'par personne',
    per_person_per_night: 'par personne et par nuit',
    per_night: 'par nuit',
    per_stay: 'au séjour',
    per_participant_progressive: 'par participant',
  };
  return { priceUnitLabel: MAP[pt] || null, quantityLabel: null };
}

function toPublicOption(row) {
  if (!row) return null;
  const labels = optionPriceLabels(row.priceType, row.showsPlanningCard);
  const out = {
    id: Number(row.id),
    title: row.title,
    titleEn: row.titleEn || null,
    description: row.description || null,
    priceType: row.priceType,
    price: Number(row.price || 0),
    // Planning-card option: booked as a time slot. On the site it's billed by quantity and « à
    // planifier avec l'hôte » (specs/public-planning-options.md).
    showsPlanningCard: Boolean(row.showsPlanningCard),
    // Backend-owned display labels (source of truth) — the site renders them as-is.
    priceUnitLabel: labels.priceUnitLabel,
    quantityLabel: labels.quantityLabel,
    // Grouping label (specs/option-categories.md §3 rule 15). '' = ungrouped = rendered in the
    // widget's flat list; a non-empty label folds it into a collapsible section.
    category: String(row.category || '').trim(),
    // Pinned outside its category's collapse even when the visitor hasn't picked it (rule 9bis).
    alwaysVisible: Number(row.alwaysVisible || 0) === 1,
  };
  if (row.autoOptionType) out.autoOptionType = row.autoOptionType;
  if (row.priceType === 'per_participant_progressive' && Array.isArray(row.optionProgressiveTiers) && row.optionProgressiveTiers.length) {
    out.progressiveTiers = row.optionProgressiveTiers;
  }
  return out;
}

// Display labels for resources, mirroring optionPriceLabels: the site renders these strings as-is,
// so adding a resource needs NO website change (specs/wp-booking-widget-redesign.md).
function resourcePriceLabels(priceType) {
  const MAP = {
    per_hour: { priceUnitLabel: 'par heure', quantityLabel: "Nombre d'heures" },
    per_stay: { priceUnitLabel: 'pour le séjour', quantityLabel: null },
    per_night: { priceUnitLabel: 'par nuit', quantityLabel: null },
    per_person: { priceUnitLabel: 'par personne', quantityLabel: null },
    per_person_per_night: { priceUnitLabel: 'par personne et par nuit', quantityLabel: null },
  };
  return MAP[String(priceType || '')] || { priceUnitLabel: null, quantityLabel: null };
}

/**
 * Public resource projection: only the fields a visitor needs to pick an add-on resource. `price` is
 * the EFFECTIVE per-property price (resolved by resourcesModel.list). Stock/quantity, opening hours,
 * slot config and internal flags are NOT exposed.
 */
function toPublicResource(row) {
  if (!row) return null;
  const labels = resourcePriceLabels(row.priceType);
  return {
    id: Number(row.id),
    name: row.name,
    description: row.note || null,
    priceType: row.priceType,
    price: Number(row.price || 0),
    // Backend-owned display labels (source of truth) — the site renders them as-is.
    priceUnitLabel: labels.priceUnitLabel,
    quantityLabel: labels.quantityLabel,
    // Hourly resources (bain nordique) are allocated by the host on the planning: the site shows the
    // « À planifier avec l'hôte » note for these, and ONLY these (spec §3.10).
    showsSchedulingNote: String(row.priceType || '') === 'per_hour',
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
function toPublicQuote(quote, { available, startDate, endDate, paymentMode = 'full' }) {
  const base = {
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
    // Grand total of the stay INCLUDING the tourist tax (finalPrice is tax-exclusive). This is the
    // headline "Total du séjour" a public consumer should display.
    totalStayPrice: Number(quote.totalStayPrice || 0),
    // The SERVER-decided payment mode (specs/public-online-deposit.md). In 'full' mode the site charges
    // the whole stay at once, so the deposit/balance blocks are OMITTED — the site must not display
    // Acompte/Solde lines that don't reflect how the guest actually pays.
    payment: { mode: paymentMode === 'deposit' ? 'deposit' : 'full' },
    complementOnArrival: Number(quote.complementAmount || 0),
  };
  if (paymentMode === 'deposit') {
    base.deposit = { amount: Number(quote.depositAmount || 0), dueDate: quote.depositDueDate || null };
    base.balance = { amount: Number(quote.balanceAmount || 0), dueDate: quote.balanceDueDate || null };
  }
  return base;
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
