/**
 * One-shot migration: re-anchor the existing `deposit_reminder` template row
 * (specs/payment-schedule-and-cancellation.md §3.7 rule 37).
 *
 * The reminder used to be scheduled off the DEVIS validity date (`anchor = 'validUntil'`, J-3) because
 * that is where the acompte deadline lived. The acompte is now due `depositDueDays` after the BOOKING
 * and carries its own date on the reservation, so the template must fire on `depositDueDate`. This is
 * not a copy change we can leave to the operator's taste: on an already-seeded install the row would
 * keep pointing at `validUntil`, which is NULL on a reservation — the reminder would simply never be
 * scheduled again, silently.
 *
 * So the scheduling contract (anchor / dayOffset / sendMode) is forced, and the copy with it: the old
 * body speaks of a quote about to expire, which is no longer what the email is about. `enabled` is
 * preserved — whether the operator wants this email at all remains their call. Guarded by the
 * `migrations` table upstream, so a later edit is never clobbered a second time.
 */

const { DEFAULT_TEMPLATES } = require('./defaultEmailTemplatesRegistry');

function runDepositReminderAnchorMigration(db) {
  let cols;
  try {
    cols = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  } catch {
    return { action: 'skipped-schema' };
  }
  if (!cols.includes('stableKey') || !cols.includes('anchor')) return { action: 'skipped-schema' };

  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'deposit_reminder');
  if (!def) return { action: 'no_def' };

  const hasEn = cols.includes('subjectEn') && cols.includes('bodyEn');
  const sql = hasEn
    ? `UPDATE email_templates
          SET name = ?, subject = ?, body = ?, subjectEn = ?, bodyEn = ?,
              anchor = ?, dayOffset = ?, sendMode = ?, updatedAt = datetime('now')
        WHERE stableKey = 'deposit_reminder'`
    : `UPDATE email_templates
          SET name = ?, subject = ?, body = ?,
              anchor = ?, dayOffset = ?, sendMode = ?, updatedAt = datetime('now')
        WHERE stableKey = 'deposit_reminder'`;
  const params = hasEn
    ? [def.name, def.subject, def.body, def.subjectEn || '', def.bodyEn || '', def.anchor, Number(def.dayOffset), def.sendMode]
    : [def.name, def.subject, def.body, def.anchor, Number(def.dayOffset), def.sendMode];

  const info = db.prepare(sql).run(...params);
  return { action: Number(info.changes) > 0 ? 'updated' : 'not_found' };
}

module.exports = { runDepositReminderAnchorMigration };
