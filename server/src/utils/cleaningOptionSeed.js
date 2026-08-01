/**
 * Cleaning ("Ménage") option tagger (specs/j1-arrival-reminder-email.md §4.1 + §5).
 *
 * The J-1 reminder needs to know whether a reservation booked the end-of-stay cleaning. The
 * operator already has a "Ménage" option, but it carries no `autoOptionType`, so it can't be
 * detected. This boot pass **promotes** that existing option to `autoOptionType = 'cleaning'`
 * — it never creates a row (unlike the linen/breakfast seeds; the operator owns the option).
 *
 * Contract:
 *   - Idempotent: only touches rows whose `autoOptionType` is currently NULL/empty.
 *   - Matched by exact (case-insensitive) title "Ménage" / "Menage".
 *   - Tags EVERY matching untyped "Ménage" on every run — so a duplicate "Ménage" created
 *     after a first one was already tagged still gets promoted (a stale early-return here used
 *     to leave such duplicates untyped, which broke SAS cleaning detection: the guest was asked
 *     to add cleaning they had already booked via the second option).
 *   - Side effect: a typed option becomes undeletable in OptionsPage
 *     (`isDeleteDisabled={(item) => Boolean(item.autoOptionType)}`) — intended, it now drives
 *     email logic.
 */

const KNOWN_TITLE_ALIASES = Object.freeze(['ménage', 'menage']);

function ensureCleaningOptionTagged(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('autoOptionType')) {
      return { action: 'skipped-schema' };
    }

    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const promotion = database.prepare(`
      UPDATE options
         SET autoOptionType = 'cleaning'
       WHERE LOWER(TRIM(title)) IN (${aliasPlaceholders})
         AND (autoOptionType IS NULL OR autoOptionType = '')
    `).run(...KNOWN_TITLE_ALIASES);

    if (promotion.changes > 0) {
      logger.log(`[seed:cleaning] tagged ${promotion.changes} "Ménage" option(s) with autoOptionType='cleaning'`);
      return { action: 'tagged', count: promotion.changes };
    }
    return { action: 'noop-no-match' };
  } catch (error) {
    console.error(`[seed:cleaning] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureCleaningOptionTagged,
  KNOWN_TITLE_ALIASES,
};
