/**
 * Default "Linge de toilette" option seeder (specs/weekly-bed-linen-tracking.md §3.5).
 *
 * Strict mirror of utils/bedLinenSeed.js — same idempotent + non-destructive contract, same
 * skip rules, same priceType / autoEnabled / undeletability story. The only differences:
 *   - flags `countsAsBathroomLinen = 1` (not `countsAsBedLinen`).
 *   - `autoOptionType = 'bathroom_linen'` marker (for the undeletability + the typed-seed
 *     existence check).
 *   - French copy in title + description.
 *
 * Skip rules (both must be true → no insert):
 *   1. No row already has `autoOptionType = 'bathroom_linen'` (idempotent boots).
 *   2. No row already has `countsAsBathroomLinen = 1` (operator-customised — typically Adrien
 *      had an "Accès SPA + serviettes" option from before this feature and ticked the new flag
 *      on it).
 */

const SEED_DEFINITION_EN = Object.freeze({
  title: 'Bath linen',
  description: 'Towels (large, medium, small). Per-guest count drives the LaundryDayCard.',
});

const SEED_DEFINITION = Object.freeze({
  title: 'Linge de toilette',
  description: 'Serviette de bain + serviette de toilette par personne. Compte les serviettes à apporter / récupérer à la blanchisserie.',
  autoOptionType: 'bathroom_linen',
});

// Title aliases promoted into the typed seed at boot (2026-06-02 follow-up). See
// utils/bedLinenSeed.js for the rationale. Adrien confirmed his prod uses the exact title
// "Linge de toilette" — we keep the alias list short and exact for safety.
const KNOWN_TITLE_ALIASES = Object.freeze(['linge de toilette']);

function ensureDefaultBathroomLinenOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType') || !cols.includes('countsAsBathroomLinen')) {
      // Schema not migrated yet — silent return (the next boot, after columns are added, will seed).
      return { action: 'skipped-schema' };
    }
    // PROMOTION PATH — unconditional + idempotent (2026-06-03 follow-up; see utils/bedLinenSeed.js
    // for the rationale). The WHERE clause only touches rows missing `autoOptionType`, so this
    // is safe to run on every boot even when a typed seed already exists.
    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'bathroom_linen', countsAsBathroomLinen = 1
       WHERE (
               countsAsBathroomLinen = 1
               OR LOWER(TRIM(title)) IN (${aliasPlaceholders})
             )
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run(...KNOWN_TITLE_ALIASES);
    if (promotion.changes > 0) {
      logger.log(`[seed:bathroom-linen] promoted ${promotion.changes} existing option(s) to the typed marker`);
    }

    // 2026-06-06 — backfill EN translation on rows with empty titleEn (typed/promoted/legacy).
    if (cols.includes('titleEn')) {
      database.prepare(`
        UPDATE options
           SET titleEn = ?, descriptionEn = COALESCE(NULLIF(descriptionEn, ''), ?)
         WHERE autoOptionType = 'bathroom_linen'
           AND (titleEn IS NULL OR titleEn = '')
      `).run(SEED_DEFINITION_EN.title, SEED_DEFINITION_EN.description);
    }

    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bathroom_linen'"
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
        'per_stay', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 1,
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
        'per_stay', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 1,
      );
    }
    logger.log('[seed:bathroom-linen] seeded default option');
    return { action: 'seeded' };
  } catch (error) {
    console.error(`[seed:bathroom-linen] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBathroomLinenOption,
  SEED_DEFINITION,
  SEED_DEFINITION_EN,
  KNOWN_TITLE_ALIASES,
};
