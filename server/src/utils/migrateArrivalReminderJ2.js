/**
 * One-shot migration: force-sync the existing `arrival_reminder_1d` template row to the current
 * registry definition (specs/email-automation.md / specs/j1-arrival-reminder-email.md).
 *
 * The template seed is insert-only (it never overwrites an existing row), so the J-1 → J-2 rework
 * (new copy: stay date instead of « demain », GPS line, nordic-bath block, cleaning-by-name fix)
 * would never reach an already-seeded row. Adrien explicitly asked to OVERWRITE it even if it was
 * personalised — so we force the name / subject / body / dayOffset from the registry. We deliberately
 * KEEP `sendMode` and `enabled` (the operator's auto-vs-manual + on/off choice). Idempotent.
 */

const { DEFAULT_TEMPLATES } = require('./defaultEmailTemplatesRegistry');

function runArrivalReminderJ2Migration(db) {
  let cols;
  try {
    cols = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  } catch {
    return { action: 'skipped-schema' };
  }
  if (!cols.includes('stableKey')) return { action: 'skipped-schema' };

  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'arrival_reminder_1d');
  if (!def) return { action: 'no_def' };

  const info = db.prepare(`
    UPDATE email_templates
       SET name = ?, subject = ?, body = ?, dayOffset = ?, updatedAt = datetime('now')
     WHERE stableKey = 'arrival_reminder_1d'
  `).run(def.name, def.subject, def.body, Number(def.dayOffset));

  return { action: Number(info.changes) > 0 ? 'updated' : 'not_found' };
}

module.exports = { runArrivalReminderJ2Migration };
