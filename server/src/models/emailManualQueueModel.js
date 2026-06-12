/**
 * Email manual queue model — sole DB access for `email_manual_queue`
 * (specs/manual-email-from-template.md §4.1 + §5).
 *
 * Stores the (templateId, reservationId) pairs the operator explicitly queued for sending.
 * The pending controller merges these with the date-driven candidates; send / acknowledge
 * remove the pair. Only the pair + createdAt is stored — the email body is always re-rendered
 * live at preview/send, so template/reservation edits are reflected (no stale snapshot).
 *
 * Exports a default model bound to the production database + a `buildModel(db)` factory for tests.
 *
 * API:
 *   add(templateId, reservationId)    → true if a new row was inserted (idempotent; existing pair → false)
 *   remove(templateId, reservationId) → boolean (true when a row was deleted)
 *   has(templateId, reservationId)    → boolean
 *   listEnriched()                    → queued rows joined with template + reservation + client + property,
 *                                       plus the most recent `sent` `lastSentAt` per pair
 */

function buildModel(database) {
  // INSERT OR IGNORE → idempotent on the (templateId, reservationId) primary key.
  const addStmt = database.prepare(`
    INSERT OR IGNORE INTO email_manual_queue (templateId, reservationId)
    VALUES (?, ?)
  `);
  const removeStmt = database.prepare(
    'DELETE FROM email_manual_queue WHERE templateId = ? AND reservationId = ?'
  );
  const hasStmt = database.prepare(
    'SELECT 1 FROM email_manual_queue WHERE templateId = ? AND reservationId = ? LIMIT 1'
  );

  // Same shape as emailLogModel.listPending so the controller can merge the two lists
  // transparently. `manual = 1` flags the row; `lastSentAt` surfaces the "déjà envoyé le …"
  // caption (most recent successful send for the pair, NULL if never sent).
  const listEnrichedStmt = database.prepare(`
    SELECT
      t.id   AS templateId,
      t.name AS templateName,
      t.dayOffset AS dayOffset,
      r.id   AS reservationId,
      r.startDate AS startDate,
      date(r.startDate, t.dayOffset || ' days') AS sendDate,
      c.id AS clientId,
      TRIM(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) AS clientFullName,
      COALESCE(c.email, '') AS clientEmail,
      COALESCE(p.name, '')  AS propertyName,
      1 AS manual,
      (
        SELECT MAX(l.sentAt) FROM email_log l
        WHERE l.templateId = t.id AND l.reservationId = r.id AND l.status = 'sent'
      ) AS lastSentAt
    FROM email_manual_queue q
    JOIN email_templates t ON t.id = q.templateId
    JOIN reservations    r ON r.id = q.reservationId
    LEFT JOIN clients    c ON c.id = r.clientId
    LEFT JOIN properties p ON p.id = r.propertyId
    WHERE COALESCE(r.kind, 'reservation') = 'reservation'
    ORDER BY q.createdAt ASC
  `);

  function add(templateId, reservationId) {
    const info = addStmt.run(Number(templateId), Number(reservationId));
    return info.changes > 0;
  }

  function remove(templateId, reservationId) {
    const info = removeStmt.run(Number(templateId), Number(reservationId));
    return info.changes > 0;
  }

  function has(templateId, reservationId) {
    return Boolean(hasStmt.get(Number(templateId), Number(reservationId)));
  }

  function listEnriched() {
    return listEnrichedStmt.all();
  }

  return { add, remove, has, listEnriched };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
