/**
 * Pricing input loader — the one place the quote of a stay reads the database (specs/pricing-components.md §3 rules 1, 11).
 *
 * Contract: `load(input)` takes the engine input (the caller's `db` among it) and returns either the engine's refusal
 * `{ error, status }` (unknown lodging) or the same input completed with what the pure pipeline needs and used to fetch
 * itself, mid-way:
 *   property, vatRegime, vatRate, rules      the lodging, the VAT regime the sale falls under, its tariff rules
 *   settings                                 what each component is parameterised with, from the SettingsProvider
 *                                            (`settings.<nights|extraGuests|touristTax|stayClock|schedule|vat|articles>`,
 *                                            the tourist-tax `collector` of the platform among them): the steps read
 *                                            these, never the property row
 *   families                                 the article families live at this instant, by id (a plugin-owned one only
 *                                            while its plugin is live): the Articles head prices with these, not the registry
 *   optionsById, resourcesById               the lodging's catalogue (through the CatalogueProvider port)
 *   defaultOfferedOptionIds                  the options the lodging includes in the night rate
 *   billableBabyBeds                         the cots the stay bills (a stay stored before the supplement bills none)
 *   paymentLedger                            the PaymentLedger port bound to the database: SCHEDULE reads the money
 *                                            received (installments, split receipts) through it, as in PR A
 * Queries are the ones the engine ran inline, unchanged.
 */
const vatRegimeModel = require('./vatRegimeModel');
const { getApplicableOptions, getApplicableResources } = require('./ports/catalogueProvider');
const { create: createPaymentLedger } = require('./ports/paymentLedger');
const settingsProvider = require('./ports/settingsProvider');
const articles = require('../utils/pricing/articles');
const { findBabyBedOption, resolveBillableBabyBeds } = require('../utils/babyBedSupplement');

// GLOBAL per-platform tourist-tax mode resolver (specs/per-platform-tourist-tax-three-way.md). The
// mode lives on the `platforms` table (one row per platform, shared across all properties), like the
// calendar colour. Returns the `{ collectsTouristTax, touristTaxRemittedByPlatform }` row or null.
//
// A reservation's `platform` string is written two ways: manual reservations store the concatenated
// label (= `platforms.name`), iCal imports store the hyphenated `source.platformKey`. So we resolve
// in two steps: (1) direct match on `platforms.name`; (2) bridge through `ical_sources` (key OR label)
// to recover the canonical `platformLabel`, then match `platforms.name`. The `propertyId` argument is
// kept for call-site compatibility but ignored — the mode is global.
function resolveGlobalPlatformTaxRow(db, platform) {
  if (!platform || platform === 'direct') return null;
  const needle = String(platform).toLowerCase();
  try {
    let row = db.prepare(
      'SELECT collectsTouristTax AS c, touristTaxRemittedByPlatform AS r FROM platforms WHERE lower(name) = ? LIMIT 1'
    ).get(needle);
    if (row) return row;
    // Bridge: an iCal-imported reservation stores the hyphenated key; map it to the canonical label
    // via any ical_sources row, then read the global mode for that label.
    row = db.prepare(`
      SELECT pl.collectsTouristTax AS c, pl.touristTaxRemittedByPlatform AS r
      FROM ical_sources s JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
      WHERE lower(s.platformKey) = ? OR lower(s.platformLabel) = ? LIMIT 1
    `).get(needle, needle);
    return row || null;
  } catch (_) {
    // `platforms`/`ical_sources` table or the tax columns may be absent in minimal test DBs.
    return null;
  }
}

function load(input) {
  const {
    db,
    propertyId,
    startDate,
    bookingId,
    platform,
    babyBeds,
    bookingDate = null,
    kind: quoteKind = 'reservation',
  } = input;
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) {
    return { error: 'Logement non trouvé', status: 404 };
  }

  // Single global VAT rate (specs/single-vat-rate.md §4.1). The three quote keys
  // (vatPercentageAccommodation / Options / Resources) below keep their names but all carry
  // the same value, so downstream readers (devisPdf, accountingModel, PricingSummary)
  // continue working without a wider rename.
  // One VAT rate per sale, the one of the regime it was sold under (specs/vat-optional-mode.md rule 8):
  // a stored stay keeps its period, a new stay or a devis is priced under the regime in force today.
  const vatRegime = vatRegimeModel.forRow(db, {
    id: bookingId, kind: quoteKind, createdAt: bookingDate, startDate, newSale: !(Number(bookingId) > 0),
  });
  const vatRate = vatRegime.rate;

  const normalizedPlatform = String(platform || 'direct').toLowerCase();
  const provider = settingsProvider.create(db);
  const scope = { propertyId, platform: normalizedPlatform };
  const settings = Object.fromEntries(
    ['nights', 'extraGuests', 'touristTax', 'stayClock', 'schedule', 'vat', 'articles'].map((component) => [component, provider.for(component, scope)]),
  );
  const rules = settings.nights.tariff.rules;
  const optionsById = new Map(getApplicableOptions(db, propertyId).map((option) => [Number(option.id), option]));
  const resourcesById = new Map(getApplicableResources(db, propertyId).map((resource) => [Number(resource.id), resource]));
  // specs/per-property-default-options.md — options that are a property DEFAULT configured « offered »
  // (`property_option_defaults.offered = 1`) are INCLUDED in the night rate, not a one-off geste
  // commercial. When such a line is offered we tag it `includedInRate` so the summary renders « Comprise »
  // (at 0 €) instead of « Offert ». Guarded for minimal test DBs without the table.
  const defaultOfferedOptionIds = (() => {
    try {
      return new Set(
        db.prepare('SELECT optionId FROM property_option_defaults WHERE propertyId = ? AND offered = 1')
          .all(propertyId)
          .map((r) => Number(r.optionId)),
      );
    } catch { return new Set(); }
  })();
  // specs/baby-bed-supplement.md §3.3 — resolved ONCE, from the database: a booking already stored
  // with cots and no supplement line was sold before the supplement existed and bills 0 cot forever.
  const babyBedOption = findBabyBedOption(Array.from(optionsById.values()));
  const billableBabyBeds = resolveBillableBabyBeds({
    database: db, bookingId, option: babyBedOption, babyBeds,
  });

  return {
    ...input,
    property,
    vatRegime,
    vatRate,
    rules,
    optionsById,
    resourcesById,
    defaultOfferedOptionIds,
    settings,
    families: articles.liveFamilies(),
    billableBabyBeds,
    paymentLedger: createPaymentLedger(db),
  };
}

module.exports = { load, resolveGlobalPlatformTaxRow };
