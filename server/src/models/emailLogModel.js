/**
 * Email log model — sole DB access for `email_log`
 * (specs/email-automation.md §4.1 + §5).
 *
 * Records every send attempt (sent / failed / acknowledged-skip) — the cron, the
 * manual-send button and the acknowledge endpoint all funnel through this model.
 *
 * API:
 *   insert({ templateId, reservationId, status, errorMessage?, renderedSubject,
 *            renderedBody, recipientEmail }) → created row
 *   existsFor(templateId, reservationId, statuses[]) → boolean
 *   listPending({ from, to })   → manual-mode candidates not yet acted on (joins reservation + client + property)
 *   history({ limit, offset, reservationId?, templateId?, status? }) → { rows, total }
 */

function buildModel(database) {
  const SELECT_COLS = 'id, templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail';

  const insertStmt = database.prepare(`
    INSERT INTO email_log
      (templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail)
    VALUES
      (@templateId, @reservationId, datetime('now'), @status, @errorMessage, @renderedSubject, @renderedBody, @recipientEmail)
  `);

  // The cron + pending list both need to know "has this (template, reservation) pair already
  // produced a `sent` or `acknowledged-skip` row?". A small prepared `IN (?, ?)` family
  // would force per-call SQL string assembly; an array-bind helper keeps it readable.
  function existsFor(templateId, reservationId, statuses = []) {
    if (!Array.isArray(statuses) || statuses.length === 0) return false;
    const placeholders = statuses.map(() => '?').join(', ');
    const row = database.prepare(
      `SELECT 1 FROM email_log WHERE templateId = ? AND reservationId = ? AND status IN (${placeholders}) LIMIT 1`
    ).get(Number(templateId), Number(reservationId), ...statuses);
    return Boolean(row);
  }

  function insert(payload) {
    const params = {
      templateId:      payload.templateId == null ? null : Number(payload.templateId),
      reservationId:   Number(payload.reservationId),
      status:          String(payload.status || ''),
      errorMessage:    String(payload.errorMessage || ''),
      renderedSubject: String(payload.renderedSubject || ''),
      renderedBody:    String(payload.renderedBody || ''),
      recipientEmail:  String(payload.recipientEmail || ''),
    };
    const info = insertStmt.run(params);
    return database.prepare(`SELECT ${SELECT_COLS} FROM email_log WHERE id = ?`).get(info.lastInsertRowid);
  }

  // Pending manual emails — used by the dashboard widget AND the EmailPendingDialog
  // (§3 rule 8). Joins email_templates × reservations × clients × properties; filters
  // out devis, expired stays > 7 days in the past, already-sent and already-acknowledged
  // pairs. Returns the rows the dashboard renders verbatim.
  function listPending({ today, lookbackDays = 7 }) {
    return database.prepare(`
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
        COALESCE(p.name, '')  AS propertyName
      FROM email_templates t
      JOIN reservations r
        ON COALESCE(r.kind, 'reservation') = 'reservation'
       AND date(r.startDate, t.dayOffset || ' days') BETWEEN date(?, '-' || ? || ' days') AND date(?)
      LEFT JOIN clients    c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE t.enabled = 1
        AND t.sendMode = 'manual'
        AND NOT EXISTS (
          SELECT 1 FROM email_log l
          WHERE l.templateId = t.id
            AND l.reservationId = r.id
            AND l.status IN ('sent', 'acknowledged-skip')
        )
      ORDER BY r.startDate ASC, t.dayOffset ASC
    `).all(String(today), Number(lookbackDays), String(today));
  }

  function history({ limit = 50, offset = 0, reservationId, templateId, status } = {}) {
    const where = [];
    const params = [];
    if (reservationId != null) { where.push('l.reservationId = ?'); params.push(Number(reservationId)); }
    if (templateId    != null) { where.push('l.templateId    = ?'); params.push(Number(templateId)); }
    if (status        != null) { where.push('l.status        = ?'); params.push(String(status)); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = database.prepare(`SELECT COUNT(*) AS n FROM email_log l ${whereClause}`).get(...params).n;

    const rows = database.prepare(`
      SELECT
        l.id, l.templateId, l.reservationId, l.sentAt, l.status, l.errorMessage,
        l.renderedSubject, l.renderedBody, l.recipientEmail,
        COALESCE(t.name, '') AS templateName,
        TRIM(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) AS clientFullName,
        COALESCE(p.name, '') AS propertyName,
        r.startDate AS reservationStartDate,
        r.endDate   AS reservationEndDate
      FROM email_log l
      LEFT JOIN email_templates t ON t.id = l.templateId
      LEFT JOIN reservations    r ON r.id = l.reservationId
      LEFT JOIN clients         c ON c.id = r.clientId
      LEFT JOIN properties      p ON p.id = r.propertyId
      ${whereClause}
      ORDER BY l.sentAt DESC, l.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    return { rows, total };
  }

  function findById(id) {
    return database.prepare(`SELECT ${SELECT_COLS} FROM email_log WHERE id = ?`).get(Number(id));
  }

  // Most recent successful-send timestamp for a (template, reservation) pair, or null if it was
  // never sent. Drives the "déjà envoyé le …" guard when queuing a manual email
  // (specs/manual-email-from-template.md §3 rule 5).
  function lastSentAt(templateId, reservationId) {
    const row = database.prepare(
      "SELECT MAX(sentAt) AS lastSentAt FROM email_log WHERE templateId = ? AND reservationId = ? AND status = 'sent'"
    ).get(Number(templateId), Number(reservationId));
    return row && row.lastSentAt ? row.lastSentAt : null;
  }

  return {
    insert,
    existsFor,
    listPending,
    history,
    findById,
    lastSentAt,
  };
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
