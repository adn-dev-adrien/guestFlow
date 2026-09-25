const {
  isPerPersonCardOption, portionCap, portionWording,
} = require('./mealPortions');
const { labels: rawLabels, normalisePublicLang } = require('./publicLabels');
const { isBabyBedResource } = require('./babyBedResource');

/**
 * Every projection normalises its own language instead of trusting the caller.
 *
 * Not defensive programming for its own sake: these functions are passed straight to `Array.map`
 * all over the controllers, and `map` hands the INDEX as the second argument — so an unguarded
 * `toPublicOption` would be called with `lang = 0`. Rule 1 also forbids erroring on a language
 * token, so the boundary is exactly here: garbage in, French out, never a throw. The dictionary
 * itself stays fail-loud for the code that calls it directly.
 */
function labelsFor(lang) {
  return rawLabels(normalisePublicLang(lang));
}

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

/**
 * Language (specs/site-english-version.md §3 rules 3-9). Every projection takes a `lang`, defaults
 * to French, and resolves its own labels through `publicLabels` — so a consumer that never sends a
 * language receives byte-identical payloads to before this existed.
 */
/**
 * Is this actually a translation resolver, or the array `Array.map` handed us as a third argument?
 *
 * The same accident `labelsFor` guards against for `lang`, one argument further along.
 */
function isResolver(candidate) {
  return Boolean(candidate)
    && typeof candidate.optionTitle === 'function'
    && typeof candidate.resourceName === 'function';
}

function resolveTitle(rawLang, title, titleEn) {
  const lang = normalisePublicLang(rawLang);
  const en = String(titleEn || '').trim();
  // Rule 4: an empty English title falls back to the French one, silently and on purpose. A missing
  // translation must look ordinary, never like an error the visitor has to interpret.
  return lang === 'en' && en ? en : title;
}

function toPublicProperty(row, lang = 'fr') {
  if (!row) return null;
  return {
    id: Number(row.id),
    // Rule 9: a property name is a proper noun and is never translated. `nameArticle` is French
    // grammar (« à la », « à l'· »), so English gets an empty one and the consumer composes
    // "at La Granja" instead.
    name: row.name,
    nameArticle: normalisePublicLang(lang) === 'en' ? '' : (row.nameArticle || null),
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
function toPublicPropertyDetail(row, lang = 'fr') {
  if (!row) return null;
  const nightly = (row.pricingRules || [])
    .map((r) => Number(r.pricePerNight))
    .filter((n) => Number.isFinite(n) && n > 0);
  const fromPricePerNight = nightly.length ? Math.min(...nightly) : null;
  return {
    ...toPublicProperty(row, lang),
    extraGuestPrice: Number(row.extraGuestPrice || 0),
    fromPricePerNight,
  };
}

// Human-readable price-basis + quantity labels for the site — computed SERVER-SIDE from priceType +
// showsPlanningCard so it is the single source of truth: adding an option needs NO website change, the
// plugin just renders these strings (specs/public-planning-options.md). A planning-card option is
// billed by the visitor's quantity on the site, so its labels differ from the back-office occurrence
// model: a PER-PERSON one counts PORTIONS — breakfasts, covers (specs/site-meal-portions.md rule 6) —
// and the others still count séances.
function optionPriceLabels(priceType, showsPlanningCard, option = null, lang = 'fr') {
  const pt = String(priceType || '');
  const perPerson = pt.indexOf('per_person') === 0;
  const L = labelsFor(lang);
  if (showsPlanningCard) {
    if (perPerson) {
      const words = portionWording(option, lang);
      return { priceUnitLabel: words.priceUnitLabel, quantityLabel: words.quantityLabel };
    }
    return { priceUnitLabel: L.sessionUnit, quantityLabel: L.sessionQuantity };
  }
  return { priceUnitLabel: L.priceUnit[pt] || null, quantityLabel: null };
}

/**
 * `translate` is the translation catalogue for the language being served
 * (specs/translation-catalogue.md rules 14-16). Optional on purpose: without it the projection falls
 * back to the row's own `titleEn`, which is what every caller did before the catalogue existed and
 * what the models still attach.
 */
function toPublicOption(row, lang = 'fr', translate = null) {
  if (!row) return null;
  const labels = optionPriceLabels(row.priceType, row.showsPlanningCard, row, lang);
  const id = Number(row.id);
  // Same reason `lang` is normalised rather than trusted: `rows.map(toPublicOption)` hands the index
  // as the second argument AND the array as the third, so an unchecked `translate` would be an array.
  const tr = isResolver(translate) ? translate : null;
  const out = {
    id,
    // Rule 4: `title` arrives ALREADY resolved, so the site renders one field whatever the language.
    // `titleEn` keeps being emitted unchanged so nothing reading it today breaks.
    title: tr ? tr.optionTitle(id, row.title) : resolveTitle(lang, row.title, row.titleEn),
    titleEn: tr ? tr.englishOptionTitle(id) : (row.titleEn || null),
    // Rule 15: a description is translated when the catalogue has it, and **omitted** otherwise —
    // never shown in French on an English page. A missing line reads better than a foreign one.
    description: tr
      ? tr.optionDescription(id, row.description)
      : (normalisePublicLang(lang) === 'en' ? null : (row.description || null)),
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
    // THE cancellation insurance (specs/cancellation-insurance.md §3.2 rule 11). The site keys on
    // this flag — never on a title — and renders it in its own block, not in the supplements list.
    isCancellationInsurance: Number(row.isCancellationInsurance || 0) === 1,
  };
  if (row.autoOptionType) out.autoOptionType = row.autoOptionType;
  if (row.priceType === 'per_participant_progressive' && Array.isArray(row.optionProgressiveTiers) && row.optionProgressiveTiers.length) {
    out.progressiveTiers = row.optionProgressiveTiers;
  }
  return out;
}

// French money/percent formatting for the labels the site renders as-is. Kept here rather than in
// the plugin so a price basis change never needs a WordPress release.
function frNumber(value) {
  const n = Number(value || 0);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return text.replace('.', ',');
}

/**
 * The cancellation-insurance block the site renders in its own section
 * (specs/cancellation-insurance.md §3.3 rules 18-19).
 *
 * `option` is the flagged option ALREADY resolved for the property (effective per-property price);
 * `amount` is what it costs for the quoted stay, priced server-side — `null` when there is no stay
 * yet (catalogue call), in which case the site falls back to `priceLabel`.
 */
function toPublicCancellationInsurance(option, {
  amount = null, selected = false, neatPricingActive = false, lang = 'fr', translate = null,
} = {}) {
  if (!option) return null;
  const tr = isResolver(translate) ? translate : null;
  const priceType = String(option.priceType || 'per_stay');
  const isPercent = priceType === 'percent_of_stay';
  const price = Number(option.price || 0);
  // Neat-derived pricing (specs/neat-cancellation-insurance-subscription.md rule 13): the static
  // tariff is only a fallback, so a 0 no longer hides the block — and there is no per-unit label
  // to print before the dates are picked, the premium being per-stay on the Neat side.
  if (price <= 0 && !neatPricingActive) return null;
  const labels = optionPriceLabels(priceType, false, null, lang);
  const L = labelsFor(lang);
  const priceLabel = neatPricingActive
    ? L.computedForYourDates
    : (isPercent
      ? `${frNumber(price)} % ${L.priceUnit.percent_of_stay}`
      : `${frNumber(price)} €${labels.priceUnitLabel ? ` ${labels.priceUnitLabel}` : ''}`);
  const id = Number(option.id);
  return {
    optionId: id,
    title: tr ? tr.optionTitle(id, option.title) : resolveTitle(lang, option.title, option.titleEn),
    titleEn: tr ? tr.englishOptionTitle(id) : (option.titleEn || null),
    description: tr
      ? tr.optionDescription(id, option.description)
      : (normalisePublicLang(lang) === 'en' ? null : (option.description || null)),
    priceType,
    percent: isPercent ? price : null,
    price,
    priceLabel,
    amount: amount == null ? null : Number(amount),
    selected: Boolean(selected),
  };
}

// Display labels for resources, mirroring optionPriceLabels: the site renders these strings as-is,
// so adding a resource needs NO website change (specs/wp-booking-widget-redesign.md).
function resourcePriceLabels(priceType, lang = 'fr') {
  const L = labelsFor(lang);
  const pt = String(priceType || '');
  const priceUnitLabel = L.quoteUnit[pt] || null;
  if (!priceUnitLabel) return { priceUnitLabel: null, quantityLabel: null };
  return { priceUnitLabel, quantityLabel: L.quoteQuantity[pt] || null };
}

/**
 * « 1 h 30 » from 90 minutes. Hours are what an hourly resource is sold in, so a bare minute count
 * would read as a different unit from the price beside it.
 */
function hoursLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours && rest) return `${hours} h ${String(rest).padStart(2, '0')}`;
  if (hours) return `${hours} h`;
  return `${rest} min`;
}

/**
 * What a stay gets for free on an hourly resource, as a ready-to-render sentence
 * (`property_resource_prices.freeMinutes` — the nordic bath's offered hour). Null when nothing is
 * offered. The site renders it as-is: raising the allowance in GuestFlow changes the website copy
 * with no deploy (CLAUDE.md §6.0).
 */
function resourceFreeLabel(freeMinutes, lang = 'fr') {
  const minutes = Math.max(0, Math.round(Number(freeMinutes || 0)));
  if (!minutes) return null;
  return labelsFor(lang).offeredPerStay(hoursLabel(minutes), isOfferedPlural(minutes));
}

/**
 * « 1 h 30 offerte », « 2 h offertes », « 30 min offertes ». The agreement follows the unit the
 * label is actually written in: an hour and a half is still ONE hour, thirty minutes are thirty.
 */
function isOfferedPlural(minutes) {
  return minutes < 60 ? minutes > 1 : minutes >= 120;
}

function offeredAgreement(minutes, lang = 'fr') {
  return labelsFor(lang).offeredAgreement(isOfferedPlural(minutes));
}

/**
 * The same allowance seen from a priced quote line: how much of what was ordered is NOT billed.
 * Null when the line is billed in full, and null when it is free in full — there the amount column
 * already says « Offert » and repeating it beside the title would say the same thing twice.
 */
function resourceOfferedNote(quantity, billedUnits, totalPrice, lang = 'fr') {
  const ordered = Math.max(0, Number(quantity || 0));
  const billed = Math.max(0, Number(billedUnits == null ? quantity : billedUnits));
  const free = roundHours(ordered - billed);
  if (free <= 0 || Number(totalPrice || 0) <= 0) return null;
  const minutes = Math.round(free * 60);
  return `${hoursLabel(minutes)} ${offeredAgreement(minutes, lang)}`;
}

function roundHours(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Public resource projection: only the fields a visitor needs to pick an add-on resource. `price` is
 * the EFFECTIVE per-property price (resolved by resourcesModel.list). Stock/quantity, opening hours,
 * slot config and internal flags are NOT exposed.
 */
function toPublicResource(row, lang = 'fr', translate = null) {
  if (!row) return null;
  const labels = resourcePriceLabels(row.priceType, lang);
  const id = Number(row.id);
  const tr = isResolver(translate) ? translate : null;
  return {
    id,
    // Rule 5: resolved like an option's title, and `nameEn` starts being exposed alongside — closing
    // an asymmetry the catalogue carried since `nameEn` was added.
    name: tr ? tr.resourceName(id, row.name) : resolveTitle(lang, row.name, row.nameEn),
    nameEn: tr ? tr.englishResourceName(id) : (row.nameEn || null),
    // A resource's `note` has no catalogue entry (rule 2 keeps the catalogue to labels), so it keeps
    // the older behaviour: absent in English rather than French.
    description: normalisePublicLang(lang) === 'en' ? null : (row.note || null),
    priceType: row.priceType,
    price: Number(row.price || 0),
    // Backend-owned display labels (source of truth) — the site renders them as-is.
    priceUnitLabel: labels.priceUnitLabel,
    quantityLabel: labels.quantityLabel,
    // Hourly resources (bain nordique) are allocated by the host on the planning: the site shows the
    // « À planifier avec l'hôte » note for these, and ONLY these (spec §3.10).
    showsSchedulingNote: String(row.priceType || '') === 'per_hour',
    // The cot, named by a flag rather than by its title (specs/translation-catalogue.md rule 22).
    // The funnel drives it from the babies stepper instead of listing it with the supplements, and
    // it used to recognise it by matching « Lit bébé » on this very payload — which stopped matching
    // the day the payload started saying « Baby bed ». Decided on the stored row, so the answer is
    // the same in every language.
    isBabyBed: isBabyBedResource(row),
    // What this property offers on the resource before billing starts. The engine already applies it
    // (pricing.applyPerHourFreeMinutes); until this field existed nothing SAID it, so the visitor read
    // « 30,00 € · par heure » on an hour that costs nothing.
    freeLabel: resourceFreeLabel(row.freeMinutes, lang),
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
/**
 * The cap on every per-person planning-card option applicable to this stay, with the French hint the
 * drawer prints under its stepper (specs/site-meal-portions.md rules 3 + 7-8). The widget caps its
 * « + » with it, which is what spares the visitor a 422 at submit time.
 */
function toPublicOptionLimits({ options, persons, nights, checkInTime, checkOutTime, property, lang = 'fr' }) {
  if (!Array.isArray(options) || !(Number(nights) > 0) || !(Number(persons) > 0)) return [];
  return options.filter(isPerPersonCardOption).map((option) => {
    const limit = portionCap({ option, persons, nights, checkInTime, checkOutTime, property });
    return {
      optionId: Number(option.id),
      maxQuantity: limit.cap,
      hint: portionWording(option, lang).hint(limit),
    };
  });
}

function toPublicQuote(quote, {
  available, startDate, endDate, paymentMode = 'full', cancellationInsurance = null, optionLimits = [],
  lang = 'fr', translate = null,
}) {
  // Rule 21 — the quote is a surface like the catalogue, and reads the same catalogue. Until it did,
  // it resolved its lines from `optionLines[].titleEn`, a column the catalogue migration dropped: the
  // English tunnel priced « Linge de lit » and « Bain nordique » under English headings.
  const tr = isResolver(translate) ? translate : null;
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
    // Rule 6: a quote asked for in English must not contain a French line. The engine carries the
    // English title beside the French one so this stays a pure projection.
    options: (quote.optionLines || []).map((o) => ({
      optionId: Number(o.optionId),
      title: tr ? tr.optionTitle(Number(o.optionId), o.title) : resolveTitle(lang, o.title, o.titleEn),
      quantity: Number(o.quantity || 0),
      unitPrice: Number(o.unitPrice || 0),
      total: Number(o.totalPrice || 0),
      offered: Boolean(o.offered),
    })),
    optionsTotal: Number(quote.optionsTotal || 0),
    // How many portions each per-person card option can still take for this stay (rule 7). Empty
    // until the stay has dates and guests.
    optionLimits: Array.isArray(optionLimits) ? optionLimits : [],
    resources: (quote.resourceLines || []).map((r) => ({
      resourceId: Number(r.resourceId),
      name: tr ? tr.resourceName(Number(r.resourceId), r.name) : resolveTitle(lang, r.name, r.nameEn),
      quantity: Number(r.quantity || 0),
      // What is actually charged once the free allowance is taken off, and the sentence that says so.
      billedQuantity: Number(r.billedUnits == null ? (r.quantity || 0) : r.billedUnits),
      offeredNote: resourceOfferedNote(r.quantity, r.billedUnits, r.totalPrice, lang),
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
    // Cancellation insurance (specs/cancellation-insurance.md §3.3 rule 19) — ALWAYS priced for
    // this stay, selected or not, so the site can show the real amount beside the Oui/Non choice.
    // Null when no insurance is configured for the property: no block, no obligation to answer.
    cancellationInsurance,
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
  toPublicOptionLimits,
  toPublicCancellationInsurance,
  toPublicResource,
  resourceFreeLabel,
  resourceOfferedNote,
  toPublicAvailability,
  toPublicQuote,
  collapseToRanges,
};
