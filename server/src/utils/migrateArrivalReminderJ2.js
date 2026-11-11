/**
 * One-shot migration: force-sync the existing `arrival_reminder_1d` template row to the current
 * registry definition (specs/email-automation.md / specs/j1-arrival-reminder-email.md).
 *
 * The template seed is insert-only (it never overwrites an existing row), so the J-1 → J-2 rework
 * (new copy: stay date instead of « demain », GPS line, nordic-bath block, cleaning-by-name fix)
 * would never reach an already-seeded row. Adrien explicitly asked to OVERWRITE it even if it was
 * personalised — so we force the name / subject / body / dayOffset from the registry. We deliberately
 * KEEP `sendMode` and `enabled` (the operator's auto-vs-manual + on/off choice). Idempotent.
 *
 * specs/j2-email-coffee-and-sas-complement.md — also force `subjectEn`/`bodyEn` (the generic EN backfill
 * only fills EMPTY columns, so registry copy changes — e.g. the new coffee/capsule line — never reach an
 * already-populated EN row). Same overwrite intent as the FR side, for this one template.
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

  // Guard the EN columns: older schemas may predate the bilingual feature. Only write them when present.
  const hasEn = cols.includes('subjectEn') && cols.includes('bodyEn');
  // Written only when a column actually differs: a re-run must not move `updatedAt`.
  const params = hasEn
    ? [def.name, def.subject, def.body, def.subjectEn || '', def.bodyEn || '', Number(def.dayOffset)]
    : [def.name, def.subject, def.body, Number(def.dayOffset)];
  const info = hasEn
    ? db.prepare(`
      UPDATE email_templates
         SET name = ?, subject = ?, body = ?, subjectEn = ?, bodyEn = ?, dayOffset = ?, updatedAt = datetime('now')
       WHERE stableKey = 'arrival_reminder_1d'
         AND (name IS NOT ? OR subject IS NOT ? OR body IS NOT ? OR subjectEn IS NOT ? OR bodyEn IS NOT ? OR dayOffset IS NOT ?)
    `).run(...params, ...params)
    : db.prepare(`
      UPDATE email_templates
         SET name = ?, subject = ?, body = ?, dayOffset = ?, updatedAt = datetime('now')
       WHERE stableKey = 'arrival_reminder_1d'
         AND (name IS NOT ? OR subject IS NOT ? OR body IS NOT ? OR dayOffset IS NOT ?)
    `).run(...params, ...params);

  if (Number(info.changes) > 0) return { action: 'updated' };
  const exists = db.prepare("SELECT 1 FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get();
  return { action: exists ? 'unchanged' : 'not_found' };
}

module.exports = { runArrivalReminderJ2Migration };
