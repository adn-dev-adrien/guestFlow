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

const SEED_DEFINITION = Object.freeze({
  title: 'Linge de toilette',
  description: 'Serviette de bain + serviette de toilette par personne. Compte les serviettes à apporter / récupérer à la blanchisserie.',
  autoOptionType: 'bathroom_linen',
});

function ensureDefaultBathroomLinenOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType') || !cols.includes('countsAsBathroomLinen')) {
      logger.log('[Database] Bathroom-linen seed skipped: schema not ready yet');
      return { action: 'skipped-schema' };
    }
    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bathroom_linen'"
    ).get().n > 0;
    if (hasTypedSeed) {
      return { action: 'skipped-already-seeded' };
    }
    // PROMOTION PATH (2026-06-02 follow-up) — see utils/bedLinenSeed.js for the rationale.
    // Same shape: any adopted row without `autoOptionType` is promoted in place to make it
    // undeletable while preserving the operator's title / price / description.
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'bathroom_linen'
       WHERE countsAsBathroomLinen = 1
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run();
    if (promotion.changes > 0) {
      logger.log(`[Database] ✅ Bathroom-linen seed promoted ${promotion.changes} existing option(s) to the typed bathroom_linen marker (kept name/price/description).`);
      return { action: 'promoted-adopted', count: promotion.changes };
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
      'per_stay',
      0,
      '[]',
      SEED_DEFINITION.autoOptionType,
      0,
      'fixed',
      null,
      0, // countsAsBedLinen = 0 (this is the towels seed, not the sheets seed)
      1,
    );
    logger.log('[Database] ✅ Default bathroom-linen option seeded.');
    return { action: 'seeded' };
  } catch (error) {
    logger.log('[Database] Bathroom-linen seed skipped due to startup error:', error.message);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBathroomLinenOption,
  SEED_DEFINITION,
};
