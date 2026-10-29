/**
 * One-shot migration: move the `installment_request` template off the `start` anchor
 * (specs/self-update-and-releases.md rule 43).
 *
 * v3.18.0's manual queue lists every enabled manual template anchored on `start` that it does not know,
 * so after a rollback the seeded row would show up as a pending email for every arriving stay. Only the
 * anchor moves; the copy, the offset and `enabled` stay the operator's. Writes only when the value differs.
 */

const ANCHOR = 'installmentDueDate';

function runInstallmentTemplateAnchorMigration(db) {
  let cols;
  try {
    cols = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  } catch {
    return { action: 'skipped-schema', changed: 0 };
  }
  if (!cols.includes('stableKey') || !cols.includes('anchor')) return { action: 'skipped-schema', changed: 0 };

  const info = db.prepare(`
    UPDATE email_templates
       SET anchor = ?, updatedAt = datetime('now')
     WHERE stableKey = 'installment_request'
       AND anchor IS NOT ?
  `).run(ANCHOR, ANCHOR);
  const changed = Number(info.changes);
  return { action: changed > 0 ? 'updated' : 'unchanged', changed };
}

module.exports = { runInstallmentTemplateAnchorMigration, ANCHOR };
