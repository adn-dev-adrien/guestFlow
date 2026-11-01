/**
 * One-shot migration: move the `dates_unavailable_notice` template off the `start` anchor
 * (specs/self-update-and-releases.md rule 43, reading of 2026-11-01 — audit R11 console N1).
 *
 * v3.19.0's manual queue lists every enabled manual template anchored on `start` that it does not know, so after a
 * rollback the row seeded by the first boot of a later release would be offered for every stay on its arrival day.
 * Its sender selects it by `stableKey` (utils/datesTakenNotice.js), never by anchor. Only the anchor moves; the copy,
 * the offset and `enabled` stay the operator's. Writes only when the value differs.
 */

const ANCHOR = 'datesTaken';

function runDatesUnavailableNoticeAnchorMigration(db) {
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
     WHERE stableKey = 'dates_unavailable_notice'
       AND anchor IS NOT ?
  `).run(ANCHOR, ANCHOR);
  const changed = Number(info.changes);
  return { action: changed > 0 ? 'updated' : 'unchanged', changed };
}

module.exports = { runDatesUnavailableNoticeAnchorMigration, ANCHOR };
