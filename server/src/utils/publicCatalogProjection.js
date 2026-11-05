/**
 * The public projections of a catalogue item (specs/public-api.md §3 rule 5): an option or a resource as
 * a guest-facing surface shows it, with its effective per-property price and its server-made labels.
 * Core, so that every surface selling the catalogue reads one projection: the website-booking plugin
 * (which re-exports them) and the guest app (specs/guest-app.md rule 24), neither depending on the other.
 *
 * Language (specs/site-english-version.md §3 rules 3-9). Every projection takes a `lang`, defaults
 * to French, and resolves its own labels through `publicLabels` — so a consumer that never sends a
 * language receives byte-identical payloads to before this existed.
 */

const { portionWording } = require('./mealPortions');
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

module.exports = {
  labelsFor,
  isResolver,
  resolveTitle,
  optionPriceLabels,
  toPublicOption,
  hoursLabel,
  isOfferedPlural,
  resourceFreeLabel,
  toPublicResource,
};
