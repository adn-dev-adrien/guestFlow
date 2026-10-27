/**
 * Schema changes of the installment plan (specs/direct-installments.md §5). Idempotent: a database that
 * already carries the new shape is left as it is, and the rebuilt tables keep every row one-to-one.
 *
 * SQLite cannot alter a CHECK or a primary key, so two tables are rebuilt (create new, copy, swap) inside
 * one transaction:
 *   - `payment_links`      — the `type` CHECK gains 'installment' and the table a nullable `installmentId`;
 *   - `email_manual_queue` — the key becomes (templateId, reservationId, occurrenceKey), so one reservation
 *                            can wait for several installments' requests under the same template.
 * `email_log` only gains the `occurrenceKey` column, and `reservations` the three aggregates the readers
 * of the stay's money (settlement, finance) take from the row.
 */

const PAYMENT_LINKS_DDL = `
  CREATE TABLE payment_links__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    type TEXT NOT NULL,
    providerLinkId TEXT,
    url TEXT NOT NULL DEFAULT '',
    amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'open',
    providerPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    paidAt TEXT,
    expiresAt TEXT,
    lastPolledAt TEXT,
    provider TEXT NOT NULL DEFAULT 'qonto',
    remoteCancelPendingAt TEXT,
    cancelReason TEXT,
    installmentId INTEGER,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement', 'installment')),
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  )`;

const MANUAL_QUEUE_DDL = `
  CREATE TABLE email_manual_queue__new (
    templateId    INTEGER NOT NULL,
    reservationId INTEGER NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    occurrenceKey TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (templateId, reservationId, occurrenceKey),
    FOREIGN KEY (templateId)    REFERENCES email_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id)    ON DELETE CASCADE
  )`;

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const tableSql = (db, table) => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row ? row.sql : null;
};

// Rebuild `table` as `ddl` (declared as `<table>__new`), copying the columns both shapes share.
function rebuild(db, table, ddl) {
  const oldColumns = columnsOf(db, table);
  db.exec(ddl);
  const shared = columnsOf(db, `${table}__new`).filter((c) => oldColumns.includes(c)).join(', ');
  db.exec(`INSERT INTO ${table}__new (${shared}) SELECT ${shared} FROM ${table}`);
  const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}__new RENAME TO ${table}`);
  if (seq) {
    const updated = db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(seq.seq, table);
    if (updated.changes === 0) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, seq.seq);
  }
}

function migrateInstallmentsSchema(db) {
  const linksSql = tableSql(db, 'payment_links');
  const rebuildLinks = Boolean(linksSql) && !linksSql.includes("'installment'");
  const hasQueue = tableSql(db, 'email_manual_queue') !== null;
  const rebuildQueue = hasQueue && !columnsOf(db, 'email_manual_queue').includes('occurrenceKey');

  db.transaction(() => {
    if (rebuildLinks) {
      rebuild(db, 'payment_links', PAYMENT_LINKS_DDL);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_payment_links_reservation ON payment_links(reservationId);
        CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);
        CREATE INDEX IF NOT EXISTS idx_payment_links_provider ON payment_links(provider, providerLinkId);
      `);
    }
    if (rebuildQueue) rebuild(db, 'email_manual_queue', MANUAL_QUEUE_DDL);

    if (tableSql(db, 'email_log') && !columnsOf(db, 'email_log').includes('occurrenceKey')) {
      db.exec("ALTER TABLE email_log ADD COLUMN occurrenceKey TEXT NOT NULL DEFAULT ''");
    }
    if (tableSql(db, 'payment_links')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_payment_links_installment ON payment_links(installmentId)');
    }
    if (tableSql(db, 'reservations')) {
      const reservationColumns = columnsOf(db, 'reservations');
      for (const column of ['installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsTarget']) {
        if (!reservationColumns.includes(column)) db.exec(`ALTER TABLE reservations ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
      }
    }
  })();
}

module.exports = { migrateInstallmentsSchema };
