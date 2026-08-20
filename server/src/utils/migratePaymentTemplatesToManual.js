/**
 * One-shot migration: stop the two dunning templates from auto-sending
 * (specs/payment-schedule-and-cancellation.md §1 amendment 2026-08-20, rules 44-45).
 *
 * `deposit_reminder` and `balance_reminder` shipped with `sendMode: 'auto'`, so the 08:00 cron mailed
 * them on its own. The operator now validates and sends every money email himself. Flipping the
 * registry is not enough: templates are seeded once, so an already-installed database keeps its `auto`
 * rows and would keep sending after deploy — the one thing this change exists to prevent.
 *
 * Only `sendMode` is touched. The copy, the anchor, the offset and `enabled` are the operator's, and
 * a reminder they had disabled stays disabled. Guarded by the `migrations` table upstream, so a later
 * deliberate switch back to `auto` is never clobbered a second time.
 */

const { PAYMENT_STABLE_KEYS } = require('./defaultEmailTemplatesRegistry');

function runPaymentTemplatesToManualMigration(db) {
  let cols;
  try {
    cols = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  } catch {
    return { action: 'skipped-schema', changed: 0 };
  }
  if (!cols.includes('stableKey') || !cols.includes('sendMode')) return { action: 'skipped-schema', changed: 0 };

  const placeholders = PAYMENT_STABLE_KEYS.map(() => '?').join(', ');
  const info = db.prepare(`
    UPDATE email_templates
       SET sendMode = 'manual', updatedAt = datetime('now')
     WHERE stableKey IN (${placeholders})
       AND sendMode = 'auto'
  `).run(...PAYMENT_STABLE_KEYS);

  const changed = Number(info.changes);
  return { action: changed > 0 ? 'updated' : 'already-manual', changed };
}

module.exports = { runPaymentTemplatesToManualMigration };
