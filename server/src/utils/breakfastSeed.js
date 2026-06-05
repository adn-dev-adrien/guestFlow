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
      logger.log('[Database] Breakfast seed skipped: schema not ready yet');
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
      logger.log(`[Database] ✅ Breakfast seed promoted ${promotion.changes} existing option(s) to the typed breakfast marker (kept name/price/description).`);
    }

    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'breakfast'",
    ).get().n > 0;
    if (hasTypedSeed) {
      return promotion.changes > 0
        ? { action: 'promoted-adopted', count: promotion.changes }
        : { action: 'skipped-already-seeded' };
    }
    database.prepare(`
      INSERT INTO options (
        title, description, priceType, price, optionProgressiveTiers,
        autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
        countsAsBedLinen, countsAsBathroomLinen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SEED_DEFINITION.title,
      SEED_DEFINITION.description,
      'per_person_per_night',
      0,
      '[]',
      SEED_DEFINITION.autoOptionType,
      0,
      'fixed',
      null,
      0, // countsAsBedLinen
      0, // countsAsBathroomLinen
    );
    logger.log('[Database] ✅ Default breakfast option seeded.');
    return { action: 'seeded' };
  } catch (error) {
    logger.log('[Database] Breakfast seed skipped due to startup error:', error.message);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBreakfastOption,
  SEED_DEFINITION,
  KNOWN_TITLE_ALIASES,
};
