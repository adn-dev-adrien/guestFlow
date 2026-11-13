/**
 * PRICING SALES — the stored columns and tables that PR C of the pricing refonte reads
 * (specs/pricing-components.md §3 rules 53, 74, 85, 86, §5; the outside-visit spec (outside-booking-sas) rules 39-42; owner decisions Q-C1, Q-C2).
 *
 * Everything here ADDS or REBUILDS a table with the same rows. No amount column is rewritten (rule 36); every backfill reads
 * stored data only and is guarded, so a second run changes nothing. `runPricingSalesMigration(db)` returns what it changed.
 *
 *   T1-T3 `standalone_sales`, `standalone_sale_lines`, `standalone_sale_payments`, `standalone_sale_history`: the sale of an article with no reservation.
 *   T4    `payment_links` rebuilt: `reservationId` nullable, `saleRef` (the link of a sale bills the sale).
 *   T5    `email_log` rebuilt: `reservationId` nullable, `saleRef` (the link e-mail is logged like every other).
 *   T6    `suggested_articles`.        T7  `options.sellableExternally`, `resources.sellableExternally`, `vatClass` on both,
 *         `vat_external_rates` (the external rate of a class), `clients.isPassage` (the shared « Passage » client, seeded by `standaloneSalesModel`).
 *   T9    the `visit_payment_request` e-mail template (`sendMode 'manual'`), seeded once by `defaultEmailTemplatesRegistry`.
 *   T10   `reservation_options` / `reservation_resources` rebuilt WITHOUT the article primary key (rule 85): `lineId` is the key,
 *         `(reservationId, optionId|resourceId)` a non-unique index, rows copied in rowid order, indexes and triggers recreated.
 *         The previous release cannot run its arrival-SAS upsert on them: the SCHEMA FLOOR 4.2.0 is raised in the same
 *         transaction (self-update rule 57).
 *   B1    `orderRef` on the lines of a guest order, where a line names exactly one order.
 *
 * Rollback (self-update rule 31): T1-T3, T6, T7 are new tables or columns ignored by the previous release; T4 and T5 only add a
 * nullable column and relax a constraint, rows with a NULL `reservationId` being invisible to the readers that join reservations;
 * T10 is blocked by the floor, not by a shim.
 */
const { raiseSchemaFloor } = require('./schemaFloor');

const SCHEMA_FLOOR_VERSION = '4.2.0';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all();
const hasColumn = (db, table, name) => columnsOf(db, table).some((c) => c.name === name);
const done = (db, name) => Boolean(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(name));
const markDone = (db, name) => db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(name);

const TABLES = [
  `CREATE TABLE IF NOT EXISTS standalone_sales (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    soldAt            TEXT NOT NULL,
    clientId          INTEGER,
    customerName      TEXT,
    customerEmail     TEXT,
    totalCents        INTEGER NOT NULL DEFAULT 0,
    vatJson           TEXT,
    status            TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('paid', 'due', 'cancelled')),
    settlementRef     TEXT,
    originRef         TEXT,
    version           INTEGER NOT NULL DEFAULT 0,
    createdBy         TEXT,
    cancelledAt       TEXT,
    noShowAt          TEXT,
    billingStreet     TEXT, billingPostcode TEXT, billingCity TEXT, billingCountry TEXT,
    qontoClientId     TEXT, qontoClientIdentity TEXT, qontoInvoiceId TEXT,
    invoiceNumber     TEXT, invoiceIssuedAt TEXT, invoiceVatRate REAL, invoiceTotal REAL,
    invoiceMarkedPaid INTEGER NOT NULL DEFAULT 0, invoiceMarkPending INTEGER NOT NULL DEFAULT 0, invoiceCancelledAt TEXT,
    attachmentState   TEXT, attachmentTransactionId TEXT, attachmentId TEXT,
    attachmentAttempts INTEGER NOT NULL DEFAULT 0, attachmentLastError TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_standalone_sales_sold ON standalone_sales(soldAt)',
  `CREATE TABLE IF NOT EXISTS standalone_sale_lines (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    saleId        INTEGER NOT NULL,
    lineId        INTEGER,
    articleRef    TEXT,
    kind          TEXT,
    family        TEXT,
    label         TEXT NOT NULL DEFAULT '',
    quantity      REAL NOT NULL DEFAULT 1,
    unitPrice     REAL NOT NULL DEFAULT 0,
    totalCents    INTEGER NOT NULL DEFAULT 0,
    catalogueCents INTEGER,
    offered       INTEGER NOT NULL DEFAULT 0,
    discountCents INTEGER NOT NULL DEFAULT 0,
    vatClass      TEXT,
    vatRate       REAL,
    components    TEXT,
    fulfilmentRef TEXT,
    soldAt        TEXT,
    source        TEXT,
    cancelledAt   TEXT,
    FOREIGN KEY (saleId) REFERENCES standalone_sales(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_standalone_sale_lines_sale ON standalone_sale_lines(saleId)',
  `CREATE TABLE IF NOT EXISTS standalone_sale_payments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    saleId         INTEGER NOT NULL,
    paidAt         TEXT NOT NULL,
    tendersJson    TEXT,
    receivedCents  INTEGER NOT NULL DEFAULT 0,
    shortfallCents INTEGER NOT NULL DEFAULT 0,
    shortfallKind  TEXT,
    source         TEXT,
    recordedAt     TEXT,
    createdBy      TEXT,
    FOREIGN KEY (saleId) REFERENCES standalone_sales(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_standalone_sale_payments_sale ON standalone_sale_payments(saleId)',
  // What was done on a document, in words (outside-visit spec rule 23): « Bière locale ×2 ajoutée », « 12,00 € encaissés : CB ».
  `CREATE TABLE IF NOT EXISTS standalone_sale_history (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    saleId INTEGER NOT NULL,
    at     TEXT NOT NULL,
    text   TEXT NOT NULL,
    actor  TEXT,
    FOREIGN KEY (saleId) REFERENCES standalone_sales(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_standalone_sale_history_sale ON standalone_sale_history(saleId)',
  // The external VAT rate of a class, set from the catalogue (owner Q-C11): `vat.rate.<class>.external` of the VAT component.
  `CREATE TABLE IF NOT EXISTS vat_external_rates (
    vatClass TEXT PRIMARY KEY,
    rate     REAL NOT NULL CHECK (rate >= 0 AND rate < 100)
  )`,
  `CREATE TABLE IF NOT EXISTS suggested_articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contextKind TEXT NOT NULL,
    contextId   TEXT NOT NULL,
    articleRef  TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (contextKind, contextId, articleRef)
  )`,
];

function createTables(db) {
  let created = 0;
  for (const statement of TABLES) {
    const name = /(?:TABLE|INDEX) IF NOT EXISTS (\w+)/.exec(statement)[1];
    const existed = statement.includes('CREATE TABLE') && hasTable(db, name);
    db.exec(statement);
    if (statement.includes('CREATE TABLE') && !existed) created += 1;
  }
  return created;
}

function addColumns(db) {
  let added = 0;
  for (const [table, name, definition] of [
    ['options', 'sellableExternally', 'INTEGER NOT NULL DEFAULT 0'],
    ['resources', 'sellableExternally', 'INTEGER NOT NULL DEFAULT 0'],
    // The VAT class of an article sold outside a stay (`options`, `resources`, `drinks`, `catering`); NULL = the class of its kind.
    ['options', 'vatClass', 'TEXT'],
    ['resources', 'vatClass', 'TEXT'],
    // The shared client of the anonymous standalone sales (rule 74): exactly one row carries it.
    ['clients', 'isPassage', 'INTEGER NOT NULL DEFAULT 0'],
    ['payment_links', 'saleRef', 'TEXT'],
    ['email_log', 'saleRef', 'TEXT'],
  ]) {
    if (!hasTable(db, table) || hasColumn(db, table, name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    added += 1;
  }
  return added;
}

/**
 * Rebuilds `table` from its own stored CREATE statement transformed by `transform`, copying every row WITH its rowid in
 * rowid order (about 115 readers sort nothing and rely on the physical order), then recreates the indexes and triggers the
 * old table carried and keeps the AUTOINCREMENT counter. The caller wraps it in a transaction with foreign keys off.
 */
function rebuildTable(db, table, transform, extraSql = []) {
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const carried = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table).map((r) => r.sql);
  const columns = columnsOf(db, table).map((c) => `"${c.name}"`);
  const sequence = hasTable(db, 'sqlite_sequence') ? db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) : null;
  const temp = `${table}__rebuild`;
  const created = transform(stored.sql).replace(/CREATE TABLE (IF NOT EXISTS )?"?\w+"?/i, `CREATE TABLE ${temp}`);
  db.exec(created);
  db.exec(`INSERT INTO ${temp} (rowid, ${columns.join(', ')}) SELECT rowid, ${columns.join(', ')} FROM ${table} ORDER BY rowid`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${temp} RENAME TO ${table}`);
  for (const sql of [...carried, ...extraSql]) db.exec(sql);
  if (sequence) db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(sequence.seq, table);
}

// Runs `work` with foreign keys off (a pragma that is a no-op inside a transaction) and legacy rename semantics, so dropping a
// table neither cascades nor makes the rename re-parse the triggers that name it. Restored in every case.
function withRebuildPragmas(db, work) {
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  const legacy = db.pragma('legacy_alter_table', { simple: true });
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    return work();
  } finally {
    db.pragma(`legacy_alter_table = ${legacy ? 'ON' : 'OFF'}`);
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

const LINK_TABLES = [
  ['payment_links', 'pricing_sales_links_v1'],
  ['email_log', 'pricing_sales_email_log_v1'],
];

function relaxReservationId(db) {
  let rebuilt = 0;
  for (const [table, marker] of LINK_TABLES) {
    if (!hasTable(db, table) || done(db, marker)) continue;
    const column = columnsOf(db, table).find((c) => c.name === 'reservationId');
    if (column && column.notnull) {
      withRebuildPragmas(db, () => db.transaction(() => {
        rebuildTable(db, table, (sql) => {
          if (!/\breservationId\s+INTEGER\s+NOT NULL/i.test(sql)) throw new Error(`PRICING_SALES_UNEXPECTED_DDL: ${table}`);
          return sql.replace(/(\breservationId\s+INTEGER)\s+NOT NULL/i, '$1');
        });
        markDone(db, marker);
      })());
      rebuilt += 1;
    } else markDone(db, marker);
  }
  return rebuilt;
}

const LINE_TABLES = [
  ['reservation_options', 'optionId'],
  ['reservation_resources', 'resourceId'],
];

/** T10 — the article primary key goes, `lineId` is the key (rule 85); the floor is raised in the same transaction. */
function dropArticleKeys(db) {
  const marker = 'pricing_sales_true_lines_v1';
  if (done(db, marker)) return 0;
  const present = LINE_TABLES.filter(([table, article]) => hasTable(db, table) && hasColumn(db, table, 'lineId') && columnsOf(db, table).some((c) => c.name === article));
  if (present.length === 0) return 0;
  withRebuildPragmas(db, () => db.transaction(() => {
    for (const [table, article] of present) {
      const keyed = columnsOf(db, table).some((c) => c.pk > 0);
      if (!keyed) continue;
      rebuildTable(
        db,
        table,
        (sql) => {
          const stripped = sql.replace(new RegExp(`,\\s*PRIMARY KEY\\s*\\(\\s*reservationId\\s*,\\s*${article}\\s*\\)`, 'i'), '');
          if (stripped === sql) throw new Error(`PRICING_SALES_UNEXPECTED_DDL: ${table}`);
          return stripped;
        },
        [`CREATE INDEX IF NOT EXISTS idx_${table}_article ON ${table} (reservationId, ${article})`],
      );
    }
    raiseSchemaFloor(db, SCHEMA_FLOOR_VERSION);
    markDone(db, marker);
  })());
  return present.length;
}

const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/**
 * B1 — `orderRef` (`order:<orderId>:<n>`) on a line when a guest order of the stay names exactly one current line of its article
 * and that line's quantity is the order's alone. A merged line (several orders, or an order added to a pre-existing quantity) is
 * ambiguous: it stays NULL, never invented (Q-C14, rule 36).
 */
function backfillOrderRefs(db) {
  if (!hasTable(db, 'guest_orders') || !hasColumn(db, 'reservation_options', 'orderRef') || !hasColumn(db, 'reservation_resources', 'orderRef')) return 0;
  const orders = db.prepare("SELECT id, reservationId, linesJson FROM guest_orders WHERE status IN ('paid', 'confirmed', 'delivered') ORDER BY id").all();
  const byStay = new Map();
  for (const order of orders) {
    const lines = parseJson(order.linesJson);
    if (!Array.isArray(lines)) continue;
    lines.forEach((line, index) => {
      if (line.kind !== 'option' && line.kind !== 'resource') return;
      const kind = line.kind;
      const id = Number(line.itemId ?? line.optionId ?? line.resourceId ?? line.id);
      if (!(id > 0)) return;
      const key = `${order.reservationId}:${kind}:${id}`;
      if (!byStay.has(key)) byStay.set(key, []);
      byStay.get(key).push({ orderId: order.id, index, quantity: Number(line.quantity) });
    });
  }
  let changed = 0;
  for (const [key, claims] of byStay) {
    if (claims.length !== 1) continue;
    const [reservationId, kind, id] = key.split(':');
    const [table, column] = kind === 'resource' ? ['reservation_resources', 'resourceId'] : ['reservation_options', 'optionId'];
    const rows = db.prepare(`SELECT lineId, quantity, orderRef FROM ${table} WHERE reservationId = ? AND ${column} = ?`).all(Number(reservationId), Number(id));
    if (rows.length !== 1 || rows[0].orderRef !== null || Number(rows[0].quantity) !== claims[0].quantity) continue;
    changed += db.prepare(`UPDATE ${table} SET orderRef = ? WHERE lineId = ? AND orderRef IS NULL`).run(`order:${claims[0].orderId}:${claims[0].index}`, rows[0].lineId).changes;
  }
  return changed;
}

/** B1 needs the guest app's table, which its plugin creates after the core migrations: `index.js` and the gate's recompute call this once. */
function backfillOrderRefsOnce(db) {
  const marker = 'pricing_order_refs_v1';
  if (done(db, marker) || !hasTable(db, 'guest_orders')) return 0;
  const changed = db.transaction(() => { const n = backfillOrderRefs(db); markDone(db, marker); return n; })();
  return changed;
}

function runPricingSalesMigration(db) {
  const changes = {};
  changes.tables = createTables(db);
  changes.columns = addColumns(db);
  changes.rebuilt = relaxReservationId(db);
  changes.trueLines = dropArticleKeys(db);
  return changes;
}

module.exports = { runPricingSalesMigration, backfillOrderRefs, backfillOrderRefsOnce, SCHEMA_FLOOR_VERSION };
