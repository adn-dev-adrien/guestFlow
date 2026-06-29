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

const { EVENT_TRIGGERED_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');

// specs/email-history-rolling-window.md §3 rule 1 — an email_log row is "current" (shown + kept) while
// today ≤ reservation.startDate + this many days; past that it is hidden by history() AND purged.
const STAY_RETENTION_DAYS = 3;

function buildModel(database) {
  const SELECT_COLS = 'id, templateId, reservationId, sentAt, status, channel, errorMessage, renderedSubject, renderedBody, recipientEmail';

  // Resolve "today" to a UTC ISO date (matches SQLite's date('now')); injectable for tests.
  const resolveToday = (today) => (today ? String(today) : new Date().toISOString().slice(0, 10));

  const insertStmt = database.prepare(`
    INSERT INTO email_log
      (templateId, reservationId, sentAt, status, channel, errorMessage, renderedSubject, renderedBody, recipientEmail)
    VALUES
      (@templateId, @reservationId, datetime('now'), @status, @channel, @errorMessage, @renderedSubject, @renderedBody, @recipientEmail)
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
      channel:         payload.channel === 'manual' ? 'manual' : 'smtp',
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
  //
  // Past-arrival guard (specs/email-automation.md §3 rule 8): a before-or-on-arrival reminder
  // (`dayOffset <= 0`, e.g. J-7 / J-2) is pointless once the guest has arrived, but the 7-day
  // lookback window would otherwise keep re-proposing it for up to a week after `startDate`
  // (a J-2's send date stays in the window until startDate + 5 days). So such pairs are dropped
  // as soon as `startDate` is in the past. Post-stay emails (`dayOffset > 0`) are meant to fire
  // after arrival and are kept regardless.
  function listPending({ today, lookbackDays = 7 }) {
    // Event-/action-triggered templates (confirmation on payment, deposit request on host action — see
    // utils/reservationEmailSender) are sent programmatically, never from this date-driven queue.
    const notEvent = EVENT_TRIGGERED_STABLE_KEYS.map(() => '?').join(', ');
    // Two scheduling anchors (specs/online-payments-qonto.md §3.8), UNION-ed so each stays readable:
    //   • 'start'      → reservations, sendDate = startDate + dayOffset (legacy; past-arrival guard).
    //   • 'validUntil' → open, deposit-unpaid devis, sendDate = validUntil + dayOffset (deposit reminder).
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
       AND (t.dayOffset > 0 OR date(r.startDate) >= date(?))
      LEFT JOIN clients    c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE t.enabled = 1
        AND t.sendMode = 'manual'
        AND COALESCE(t.anchor, 'start') = 'start'
        AND COALESCE(t.stableKey, '') NOT IN (${notEvent})
        AND NOT EXISTS (
          SELECT 1 FROM email_log l
          WHERE l.templateId = t.id AND l.reservationId = r.id
            AND l.status IN ('sent', 'acknowledged-skip')
        )

      UNION ALL

      SELECT
        t.id   AS templateId,
        t.name AS templateName,
        t.dayOffset AS dayOffset,
        r.id   AS reservationId,
        r.startDate AS startDate,
        date(r.validUntil, t.dayOffset || ' days') AS sendDate,
        c.id AS clientId,
        TRIM(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) AS clientFullName,
        COALESCE(c.email, '') AS clientEmail,
        COALESCE(p.name, '')  AS propertyName
      FROM email_templates t
      JOIN reservations r
        ON COALESCE(r.kind, '') = 'devis'
       AND r.validUntil IS NOT NULL
       AND COALESCE(r.devisStatus, '') NOT IN ('converted', 'abandoned')
       AND COALESCE(r.convertedReservationId, 0) = 0
       AND COALESCE(r.depositPaid, 0) != 1
       AND date(r.validUntil, t.dayOffset || ' days') BETWEEN date(?, '-' || ? || ' days') AND date(?)
      LEFT JOIN clients    c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE t.enabled = 1
        AND t.sendMode = 'manual'
        AND COALESCE(t.anchor, 'start') = 'validUntil'
        AND COALESCE(t.stableKey, '') NOT IN (${notEvent})
        AND NOT EXISTS (
          SELECT 1 FROM email_log l
          WHERE l.templateId = t.id AND l.reservationId = r.id
            AND l.status IN ('sent', 'acknowledged-skip')
        )

      ORDER BY startDate ASC, dayOffset ASC
    `).all(
      String(today), Number(lookbackDays), String(today), String(today), ...EVENT_TRIGGERED_STABLE_KEYS,
      String(today), Number(lookbackDays), String(today), ...EVENT_TRIGGERED_STABLE_KEYS,
    );
  }

  // Rolling-window history (specs/email-history-rolling-window.md §3 rule 2): only rows whose reservation
  // exists AND is still current (today ≤ startDate + retention). The INNER JOIN to reservations also drops
  // orphan rows (email_log has no FK cascade). The retention + today are bound, never interpolated.
  function history({ limit = 50, offset = 0, reservationId, templateId, status, today } = {}) {
    const day = resolveToday(today);
    // Window predicate first → its two params lead the positional list.
    const where = ["date(r.startDate, '+' || ? || ' days') >= date(?)"];
    const params = [STAY_RETENTION_DAYS, day];
    if (reservationId != null) { where.push('l.reservationId = ?'); params.push(Number(reservationId)); }
    if (templateId    != null) { where.push('l.templateId    = ?'); params.push(Number(templateId)); }
    if (status        != null) { where.push('l.status        = ?'); params.push(String(status)); }
    const whereClause = `WHERE ${where.join(' AND ')}`;

    const total = database.prepare(`
      SELECT COUNT(*) AS n
      FROM email_log l
      JOIN reservations r ON r.id = l.reservationId
      ${whereClause}
    `).get(...params).n;

    const rows = database.prepare(`
      SELECT
        l.id, l.templateId, l.reservationId, l.sentAt, l.status, l.channel, l.errorMessage,
        l.renderedSubject, l.renderedBody, l.recipientEmail,
        COALESCE(t.name, '') AS templateName,
        TRIM(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) AS clientFullName,
        COALESCE(p.name, '') AS propertyName,
        r.startDate AS reservationStartDate,
        r.endDate   AS reservationEndDate
      FROM email_log l
      JOIN reservations         r ON r.id = l.reservationId
      LEFT JOIN email_templates t ON t.id = l.templateId
      LEFT JOIN clients         c ON c.id = r.clientId
      LEFT JOIN properties      p ON p.id = r.propertyId
      ${whereClause}
      ORDER BY l.sentAt DESC, l.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    return { rows, total };
  }

  // Purge every email_log row that is no longer current (specs/email-history-rolling-window.md §3 rule 3):
  // no reservation backs it within the retention window — covers both past-window rows and orphans (the
  // reservation was deleted). Idempotent; returns the number of rows removed. `today` injectable for tests.
  function purgeRealizedStays(today) {
    const day = resolveToday(today);
    const info = database.prepare(`
      DELETE FROM email_log
      WHERE NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = email_log.reservationId
          AND date(r.startDate, '+' || ? || ' days') >= date(?)
      )
    `).run(STAY_RETENTION_DAYS, day);
    return info.changes;
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
    purgeRealizedStays,
    findById,
    lastSentAt,
  };
}

buildModel.STAY_RETENTION_DAYS = STAY_RETENTION_DAYS;

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
