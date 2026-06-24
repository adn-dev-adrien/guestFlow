/**
 * Default "Tapis de bain" option seeder (specs/laundry-bath-mat.md §3 rule 1).
 *
 * Strict mirror of utils/bathroomLinenSeed.js — same idempotent + non-destructive contract, same
 * skip rules, same priceType / autoEnabled / undeletability story. The only differences:
 *   - flag `countsAsBathMat = 1` (not `countsAsBathroomLinen`).
 *   - `autoOptionType = 'bath_mat'` marker (for the undeletability + the typed-seed existence check).
 *   - French copy in title + description.
 *
 * Skip rules (both must be true → no insert):
 *   1. No row already has `autoOptionType = 'bath_mat'` (idempotent boots).
 *   2. No row already has `countsAsBathMat = 1` (operator-customised).
 */

// English title used by the EN devis PDF (specs/devis-english-language.md §3 rule 6).
const SEED_DEFINITION_EN = Object.freeze({
  title: 'Bath mat',
});

const SEED_DEFINITION = Object.freeze({
  title: 'Tapis de bain',
  description: 'Tapis de bain par location. Compte les tapis à apporter / récupérer à la blanchisserie.',
  autoOptionType: 'bath_mat',
});

// Title aliases promoted into the typed seed at boot. Kept short + exact, like the sibling seeds.
const KNOWN_TITLE_ALIASES = Object.freeze(['tapis de bain']);

function ensureDefaultBathMatOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType') || !cols.includes('countsAsBathMat')) {
      // Schema not migrated yet — silent return (the next boot, after columns are added, will seed).
      return { action: 'skipped-schema' };
    }
    // PROMOTION PATH — unconditional + idempotent (see utils/bathroomLinenSeed.js for the rationale).
    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'bath_mat', countsAsBathMat = 1
       WHERE (
               countsAsBathMat = 1
               OR LOWER(TRIM(title)) IN (${aliasPlaceholders})
             )
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run(...KNOWN_TITLE_ALIASES);
    if (promotion.changes > 0) {
      logger.log(`[seed:bath-mat] promoted ${promotion.changes} existing option(s) to the typed marker`);
    }

    // Backfill EN title on rows with empty titleEn (typed/promoted/legacy).
    if (cols.includes('titleEn')) {
      database.prepare(`
        UPDATE options
           SET titleEn = ?
         WHERE autoOptionType = 'bath_mat'
           AND (titleEn IS NULL OR titleEn = '')
      `).run(SEED_DEFINITION_EN.title);
    }

    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bath_mat'"
    ).get().n > 0;
    if (hasTypedSeed) {
      return promotion.changes > 0
        ? { action: 'promoted-adopted', count: promotion.changes }
        : { action: 'skipped-already-seeded' };
    }
    // `displayToClient = 0` → bath mats are internal-only by default (specs/laundry-bath-mat.md §3
    // rule 12): counted in the laundry cards + stock, hidden from every client-facing surface until
    // the operator flips the switch. Guarded: only set when the column exists (else the legacy
    // INSERT shape is used and the row defaults to visible — harmless on minimal schemas).
    const hasDisplayToClient = cols.includes('displayToClient');
    if (cols.includes('titleEn')) {
      database.prepare(`
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen, countsAsBathMat, titleEn
          ${hasDisplayToClient ? ', displayToClient' : ''}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasDisplayToClient ? ', 0' : ''})
      `).run(
        SEED_DEFINITION.title, SEED_DEFINITION.description,
        'per_stay', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 0, 1,
        SEED_DEFINITION_EN.title,
      );
    } else {
      database.prepare(`
        INSERT INTO options (
          title, description, priceType, price, optionProgressiveTiers,
          autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
          countsAsBedLinen, countsAsBathroomLinen, countsAsBathMat
          ${hasDisplayToClient ? ', displayToClient' : ''}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasDisplayToClient ? ', 0' : ''})
      `).run(
        SEED_DEFINITION.title, SEED_DEFINITION.description,
        'per_stay', 0, '[]',
        SEED_DEFINITION.autoOptionType, 0, 'fixed', null,
        0, 0, 1,
      );
    }
    logger.log('[seed:bath-mat] seeded default option');
    return { action: 'seeded' };
  } catch (error) {
    console.error(`[seed:bath-mat] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBathMatOption,
  SEED_DEFINITION,
  SEED_DEFINITION_EN,
  KNOWN_TITLE_ALIASES,
};
