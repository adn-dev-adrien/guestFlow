/**
 * Default "Linge de lit" option seeder (specs/weekly-bed-linen-tracking.md).
 *
 * Idempotent + non-destructive boot-time seed. Runs on every server start; only inserts when
 * both invariants hold:
 *
 *   1. **No typed seed row.** A previous boot may already have inserted the seed —
 *      `autoOptionType = 'bed_linen'` is the marker, so subsequent boots short-circuit.
 *   2. **No operator-adopted option.** Some prod servers had a manually-created "Linge de
 *      lit" option BEFORE this feature shipped. Once the operator ticks the new
 *      `countsAsBedLinen` flag on their existing option, the seed must NOT add a duplicate
 *      alongside it. Detected by `SELECT COUNT(*) WHERE countsAsBedLinen = 1`.
 *
 * The seed row carries:
 *   - `autoOptionType = 'bed_linen'` → undeletable in the OptionsPage UI (the existing
 *     `isDeleteDisabled={(item) => Boolean(item.autoOptionType)}` rule).
 *   - `autoEnabled = 0` → unlike early/late check, no automatic addition: Adrien ticks it
 *     on a per-reservation basis (the option is a service the guest opts into).
 *   - `priceType = 'per_stay'`, `price = 0` → starts free; Adrien sets the actual price
 *     via the OptionsPage form. The price is independent of the linen accounting (rule 17
 *     of the spec: pure metadata, no pricing impact).
 *   - `countsAsBedLinen = 1` → drives the LaundryDayCard out of the box.
 *
 * Returns a `{ action }` tag — useful for the unit tests and the boot-time log.
 */

const SEED_DEFINITION = Object.freeze({
  title: 'Linge de lit',
  description: 'Parure complète (drap, drap-housse, taie d\'oreiller). Compte les parures à apporter / récupérer à la blanchisserie.',
  autoOptionType: 'bed_linen',
});

function ensureDefaultBedLinenOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType') || !cols.includes('countsAsBedLinen')) {
      logger.log('[Database] Bed-linen seed skipped: schema not ready yet');
      return { action: 'skipped-schema' };
    }
    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bed_linen'"
    ).get().n > 0;
    if (hasTypedSeed) {
      // Idempotent boot — the seed is already in place. Nothing to log; this is the
      // common path on every restart after the first.
      return { action: 'skipped-already-seeded' };
    }
    // PROMOTION PATH (2026-06-02 follow-up). When a prior version of this seeder skipped on
    // "operator-customised" detection, the operator's option stayed deletable because it never
    // got the `autoOptionType` marker (the only signal `OptionsPage` reads for the
    // undeletability rule). Instead of skipping, we now PROMOTE every adopted row in place:
    // set `autoOptionType = 'bed_linen'` so the UI treats it as the default linen option. The
    // operator's customisations (title, price, description) are preserved — only the type
    // marker is added. After promotion, subsequent boots short-circuit via `hasTypedSeed`.
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'bed_linen'
       WHERE countsAsBedLinen = 1
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run();
    if (promotion.changes > 0) {
      logger.log(`[Database] ✅ Bed-linen seed promoted ${promotion.changes} existing option(s) to the typed bed_linen marker (kept name/price/description).`);
      return { action: 'promoted-adopted', count: promotion.changes };
    }
    database.prepare(`
      INSERT INTO options (
        title, description, priceType, price, optionProgressiveTiers,
        autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold,
        countsAsBedLinen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      1,
    );
    logger.log('[Database] ✅ Default bed-linen option seeded.');
    return { action: 'seeded' };
  } catch (error) {
    logger.log('[Database] Bed-linen seed skipped due to startup error:', error.message);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBedLinenOption,
  SEED_DEFINITION,
};
