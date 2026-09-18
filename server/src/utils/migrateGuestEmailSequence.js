/**
 * One-shot migration `guest_email_sequence_v1` (specs/guest-email-sequence.md §5).
 *
 * 1. Force-sync the three existing sequence templates (confirmation, J-7, J-2) to the registry: the
 *    seed is insert-only, and Adrien validated the new copy and asked for it to replace the old one —
 *    in-app edits of those three rows are overwritten, as `migrateArrivalReminderJ2` did before.
 *    `enabled` is preserved. The three new templates are inserted by the regular seed.
 * 2. Copy every sequence email already SENT, still visible in `email_log`, into the ledger, so the
 *    sequence can never send it a second time after the deploy.
 */

const { DEFAULT_TEMPLATES } = require('./defaultEmailTemplatesRegistry');
const { STAY_STABLE_KEYS, stayDedupKey } = require('./guestEmailSequence');

const FORCE_SYNCED_KEYS = ['reservation_confirmation', 'arrival_reminder_7d', 'arrival_reminder_1d'];

function runGuestEmailSequenceMigration(database) {
  const cols = database.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  const hasEn = cols.includes('subjectEn') && cols.includes('bodyEn');
  const hasAnchor = cols.includes('anchor');

  let templatesSynced = 0;
  for (const key of FORCE_SYNCED_KEYS) {
    const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === key);
    if (!def) continue;
    const sets = ['name = @name', 'subject = @subject', 'body = @body', 'dayOffset = @dayOffset', 'sendMode = @sendMode'];
    if (hasEn) sets.push('subjectEn = @subjectEn', 'bodyEn = @bodyEn');
    if (hasAnchor) sets.push('anchor = @anchor');
    const info = database.prepare(`
      UPDATE email_templates SET ${sets.join(', ')}, updatedAt = datetime('now') WHERE stableKey = @stableKey
    `).run({
      stableKey: key,
      name: def.name,
      subject: def.subject,
      body: def.body,
      dayOffset: Number(def.dayOffset),
      sendMode: def.sendMode,
      subjectEn: def.subjectEn || '',
      bodyEn: def.bodyEn || '',
      anchor: def.anchor || 'start',
    });
    templatesSynced += info.changes;
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO guest_email_sends
      (dedupKey, stableKey, reservationId, clientId, status, claimedAt, sentAt, recipientEmail, emailLogId)
    VALUES (@dedupKey, @stableKey, @reservationId, @clientId, 'sent', @sentAt, @sentAt, @recipientEmail, @emailLogId)
  `);
  const sent = database.prepare(`
    SELECT l.id, l.reservationId, l.sentAt, l.recipientEmail, t.stableKey, r.clientId
      FROM email_log l
      JOIN email_templates t ON t.id = l.templateId
      LEFT JOIN reservations r ON r.id = l.reservationId
     WHERE l.status = 'sent' AND t.stableKey IN (${STAY_STABLE_KEYS.map(() => '?').join(', ')})
     ORDER BY l.sentAt ASC
  `).all(...STAY_STABLE_KEYS);
  let ledgerBackfilled = 0;
  for (const row of sent) {
    const info = insert.run({
      dedupKey: stayDedupKey(row.stableKey, row.reservationId),
      stableKey: row.stableKey,
      reservationId: row.reservationId,
      clientId: row.clientId == null ? null : row.clientId,
      sentAt: row.sentAt,
      recipientEmail: row.recipientEmail || '',
      emailLogId: row.id,
    });
    ledgerBackfilled += info.changes;
  }

  // Rule 16 — an installation where automatic sending is ALREADY on starts its sequence today, never
  // earlier: past stays are not mailed retroactively.
  const settingsCols = database.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
  if (settingsCols.includes('guestSequenceStartDate') && settingsCols.includes('emailAutoSendEnabled')) {
    database.prepare(`
      UPDATE app_settings SET guestSequenceStartDate = date('now', 'localtime')
       WHERE emailAutoSendEnabled = 1 AND COALESCE(guestSequenceStartDate, '') = ''
    `).run();
  }

  return { templatesSynced, ledgerBackfilled };
}

module.exports = { runGuestEmailSequenceMigration, FORCE_SYNCED_KEYS };
