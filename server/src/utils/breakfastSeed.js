/**
 * Default "Petit déjeuner" option seeder (specs/breakfast-option-and-planning-card.md §3 rule 1).
 *
 * Idempotent + non-destructive boot-time seed, mirror of `bedLinenSeed.js` and
 * `bathroomLinenSeed.js`. Runs on every server start; only inserts when both invariants
 * hold:
 *
 *   1. **No typed seed row.** A previous boot may already have inserted the seed —
 *      `autoOptionType = 'breakfast'` is the marker, so subsequent boots short-circuit.
 *   2. **No operator-adopted option.** Some prod servers had a manually-created
 *      "Petit déjeuner" option before this feature shipped. The promotion path catches
 *      common title variants and marks them as the typed seed, avoiding a duplicate.
 *
 * The seeded row carries:
 *   - `autoOptionType = 'breakfast'` → undeletable in the OptionsPage UI (the existing
 *     `isDeleteDisabled={(item) => Boolean(item.autoOptionType)}` rule) + the canonical
 *     discriminator used by `breakfastModel` to find eligible reservations.
 *   - `autoEnabled = 0` → not auto-added per reservation; the operator ticks it as a
 *     guest-opt-in service.
 *   - `priceType = 'per_person_per_night'`, `price = 0` → starts free; the operator sets
 *     the actual price via the OptionsPage form. The planning aggregation is independent
 *     of pricing.
 *   - `countsAsBedLinen = 0`, `countsAsBathroomLinen = 0` → breakfast is neither linen
 *     family; the laundry aggregators ignore it.
 *
 * Returns a `{ action }` tag — useful for the unit tests and the boot-time log.
 */

const SEED_DEFINITION = Object.freeze({
  title: 'Petit déjeuner',
  description: 'Petit déjeuner servi le matin (du lendemain de l\'arrivée au jour du départ inclus). Apparaît sur le Planning pour chaque jour où la réservation est présente.',
  autoOptionType: 'breakfast',
});

// English translation surfaced in the EN devis PDF (specs/devis-english-language.md §3 rule 6).
const SEED_DEFINITION_EN = Object.freeze({
  title: 'Breakfast',
  description: 'Breakfast served in the morning (from the day after arrival through the day of departure). Appears on the Planning for each day the booking is present.',
});

// Title aliases promoted to the typed seed at boot. Same defensive strategy as the linen
// seeds: catch the common variations operators might have written by hand before this
// feature shipped, so no duplicate is inserted alongside the legacy row.
const KNOWN_TITLE_ALIASES = Object.freeze([
  'petit déjeuner',
  'petit-déjeuner',
  'petits déjeuners',
  'petit dejeuner',
  'petit-dejeuner',
]);

function ensureDefaultBreakfastOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType')) {
      // Schema not migrated yet — silent return (the next boot, after columns are added, will seed).
      return { action: 'skipped-schema' };
    }
    // PROMOTION PATH (runs unconditionally every boot). Same shape + rationale as the
    // bed-linen seed: the WHERE clause is self-idempotent (only touches rows missing
    // `autoOptionType`), so it's safe to run every time. This catches the prod scenario
    // where an operator created "Petit déjeuner" by hand before the feature existed.
    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'breakfast'
       WHERE LOWER(TRIM(title)) IN (${aliasPlaceholders})
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run(...KNOWN_TITLE_ALIASES);
    if (promotion.changes > 0) {
      logger.log(`[seed:breakfast] promoted ${promotion.changes} existing option(s) to the typed marker`);
    }

    // 2026-06-06 — backfill EN translation on rows with empty titleEn.
    if (cols.includes('titleEn')) {
      database.prepare(`
        UPDATE options
           SET titleEn = ?, descriptionEn = COALESCE(NULLIF(descriptionEn, ''), ?)
         WHERE autoOptionType = 'breakfast'
           AND (titleEn IS NULL OR titleEn = '')
      `).run(SEED_DEFINITION_EN.title, SEED_DEFINITION_EN.description);
    }

    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'breakfast'",
    ).get().n > 0;
    if (hasTypedSeed) {
      return promotion.changes > 0
        ? { action: 'promoted-adopted', count: promotion.changes }
        : { action: 'skipped-already-seeded' };
    }
    const hasEnCols = cols.includes('titleEn') && cols.includes('descriptionEn');
    if (hasEnCols) {
      database.prepare(`
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen, titleEn, descriptionEn
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        SEED_DEFINITION.title, SEED_DEFINITION.description,
        'per_person_per_night', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 0,
        SEED_DEFINITION_EN.title, SEED_DEFINITION_EN.description,
      );
    } else {
      database.prepare(`
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        SEED_DEFINITION.title, SEED_DEFINITION.description,
        'per_person_per_night', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 0,
      );
    }
    logger.log('[seed:breakfast] seeded default option');
    return { action: 'seeded' };
  } catch (error) {
    console.error(`[seed:breakfast] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBreakfastOption,
  SEED_DEFINITION,
  SEED_DEFINITION_EN,
  KNOWN_TITLE_ALIASES,
};
