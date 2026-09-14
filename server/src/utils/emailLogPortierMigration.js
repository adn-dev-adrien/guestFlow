/**
 * email_log learns to wait for Portier (specs/gate-access-portier.md §3.2 + §5).
 *
 * Two statuses join the log — `waiting_portier` (the email is composed only once Portier answers) and
 * `skipped` (a waiting email dropped because its reservation was cancelled or its template disabled)
 * — with three columns: `nextAttemptAt`, `waitingSince`, `adminNotifiedAt`.
 *
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt: create the new shape, copy every
 * row with its id, drop, rename, recreate the indexes. The caller runs it inside a transaction; it is
 * a no-op once the table already accepts `waiting_portier`, so a fresh install (schema.sql baseline,
 * then this) and an old instance end on the same shape.
 */

const EMAIL_LOG_WITH_PORTIER_SQL = `
  CREATE TABLE email_log_portier (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER,
    reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL,
    renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT 'smtp',
    nextAttemptAt TEXT,
    waitingSince TEXT,
    adminNotifiedAt TEXT,
    CHECK (status IN ('sent', 'failed', 'acknowledged-skip', 'waiting_portier', 'skipped'))
  )
`;

const COPIED_COLUMNS = [
  'id', 'templateId', 'reservationId', 'sentAt', 'status', 'errorMessage',
  'renderedSubject', 'renderedBody', 'recipientEmail', 'channel',
];

function emailLogAcceptsWaiting(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'email_log'").get();
  return Boolean(row && /waiting_portier/.test(row.sql));
}

/** @returns {{ rebuilt: boolean, rows: number }} */
function runEmailLogPortierMigration(db) {
  if (emailLogAcceptsWaiting(db)) return { rebuilt: false, rows: 0 };
  const existing = new Set(db.prepare('PRAGMA table_info(email_log)').all().map((c) => c.name));
  const columns = COPIED_COLUMNS.filter((c) => existing.has(c)).join(', ');
  db.exec(EMAIL_LOG_WITH_PORTIER_SQL);
  const { changes } = db.prepare(`INSERT INTO email_log_portier (${columns}) SELECT ${columns} FROM email_log`).run();
  db.exec('DROP TABLE email_log');
  db.exec('ALTER TABLE email_log_portier RENAME TO email_log');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_log_reservation ON email_log(reservationId);
    CREATE INDEX IF NOT EXISTS idx_email_log_status_sent ON email_log(status, sentAt DESC);
    CREATE INDEX IF NOT EXISTS idx_email_log_template_res ON email_log(templateId, reservationId);
    CREATE INDEX IF NOT EXISTS idx_email_log_waiting ON email_log(status, nextAttemptAt);
  `);
  return { rebuilt: true, rows: changes };
}

module.exports = { runEmailLogPortierMigration, emailLogAcceptsWaiting };
