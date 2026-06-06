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

// Title aliases promoted into the typed seed at boot (2026-06-02 follow-up). Adrien confirmed
// his prod has a "Linge de lits" (plural) row that's the same option semantically — auto-promote
// it transparently rather than ask the operator to clean up by hand. Matched case-insensitive
// + trimmed. Keep the list intentionally short and exact — broad fuzzy matching could swallow
// legitimately-different options (e.g. "Drap supplémentaire").
const KNOWN_TITLE_ALIASES = Object.freeze(['linge de lit', 'linge de lits']);

function ensureDefaultBedLinenOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType') || !cols.includes('countsAsBedLinen')) {
      // Schema not migrated yet — silent return; the column migrations above will fix it
      // and the next boot will seed normally. No log line on every restart.
      return { action: 'skipped-schema' };
    }
    // PROMOTION PATH (runs UNCONDITIONALLY on every boot — 2026-06-03 follow-up).
    //
    // The WHERE clause is idempotent: it only touches rows that don't already carry an
    // `autoOptionType` marker. So this is safe to run on every boot regardless of whether the
    // typed seed exists. Why "unconditional" matters: an earlier version of this seeder (pre
    // 2026-06-02 alias support) ran the promotion ONLY when no typed seed existed. On prod
    // servers that bootstrapped during that interval, the seed inserted a fresh "Linge de lit"
    // alongside an existing legacy "Linge de lits" — and subsequent boots skipped the
    // promotion entirely (hasTypedSeed=true short-circuit), leaving "Linge de lits" still
    // deletable. Adrien's prod hit this exact case. Moving the promotion before the
    // hasTypedSeed check (and not gating it on that flag) finishes the job on next restart.
    //
    // Two match channels OR'd in the WHERE:
    //   - `countsAsBedLinen = 1` → operator explicitly opted in via the (now hidden) flag.
    //   - title in `KNOWN_TITLE_ALIASES` → covers the "I named it 'Linge de lits' before the
    //     feature existed" prod scenario (transparent migration, no manual cleanup).
    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'bed_linen', countsAsBedLinen = 1
       WHERE (
               countsAsBedLinen = 1
               OR LOWER(TRIM(title)) IN (${aliasPlaceholders})
             )
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run(...KNOWN_TITLE_ALIASES);
    if (promotion.changes > 0) {
      logger.log(`[seed:bed-linen] promoted ${promotion.changes} existing option(s) to the typed marker`);
    }

    const hasTypedSeed = database.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bed_linen'"
    ).get().n > 0;
    if (hasTypedSeed) {
      // Common path on steady-state boots. If we also promoted on this run, surface that in
      // the action tag for the test harness — the operator already saw the log line above.
      return promotion.changes > 0
        ? { action: 'promoted-adopted', count: promotion.changes }
        : { action: 'skipped-already-seeded' };
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
    logger.log('[seed:bed-linen] seeded default option');
    return { action: 'seeded' };
  } catch (error) {
    // Surface only when something actually breaks — silent in normal boots.
    console.error(`[seed:bed-linen] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultBedLinenOption,
  SEED_DEFINITION,
  KNOWN_TITLE_ALIASES,
};
