/**
 * PRICING SALES — the stored columns and tables that PR C of the pricing refonte reads
 * (specs/pricing/pricing-components.md §3 rules 53, 74, 85, 86, §5; the outside-visit spec (outside-booking-sas) rules 39-42; owner decisions Q-C1, Q-C2).
 *
 * Everything here ADDS or REBUILDS a table with the same rows. No amount column is rewritten (rule 36); every backfill reads
 * stored data only and is guarded, so a second run changes nothing. `runPricingSalesMigration(db)` returns what it changed.
 *
 *   T1-T3 `standalone_sales`, `standalone_sale_lines`, `standalone_sale_payments`, `standalone_sale_history`: the sale of an article with no reservation;
 *         `standalone_sale_obligations`: the money a document owes back with no line to hold it (a link paid after the reste moved).
 *   T4    `payment_links` rebuilt: `reservationId` nullable, `saleRef` (the link of a sale bills the sale).
 *   T5    `email_log` rebuilt: `reservationId` nullable, `saleRef` (the link e-mail is logged like every other).
 *   T6    `suggested_articles`.        T7  `options.sellableExternally`, `resources.sellableExternally`, `vatClass` on both,
 *         `vat_external_rates` (the external rate of a class), `clients.isPassage` (the shared « Passage » client, seeded by `standaloneSalesModel`).
 *   T9    the `visit_payment_request` e-mail template (`sendMode 'manual'`), seeded once by `defaultEmailTemplatesRegistry`.
 *   T10   `reservation_options` / `reservation_resources` rebuilt WITHOUT the article primary key (rule 85): `lineId` is the key,
 *         `(reservationId, optionId|resourceId)` a non-unique index, rows copied in rowid order, indexes and triggers recreated.
 *         The previous release cannot run its arrival-SAS upsert on them: the SCHEMA FLOOR 4.2.0 is raised in the same
 *         transaction (self-update rule 57). It is the one step the previous release cannot run on, so it waits for the update's
 *         verification (`deferTrueLines`, end review R1-2): a 4.2.0 the helper rolls back leaves a database 4.1.0 runs unchanged;
 *         `index.js` runs it once the helper has written `done` (`runTrueLinesWhenVerified`).
 *   T12   the DEPARTURE LINE GUARD (end review R1-1): a trigger refuses to delete a departure charge line (`sasLineKey 'departure:%'`)
 *         of a stay that still exists unless the deleting code first names the row in `departure_line_deletes`. A previous release
 *         that rewrites the fiche's custom lines (DELETE + INSERT) therefore fails loudly instead of billing the charges twice.
 *   B1    `orderRef` on the lines of a guest order, where a line names exactly one order.
 *   T11   `reservations.readsSaleLines` (0 on every existing row): the stays the sale-line readers serve (utils/saleLinesReaders.js).
 *   T13   `receipt_line_splits` (empty): the sale lines each payment day of a stay the readers serve is cut over, frozen when the money
 *         is taken (rule 99, utils/receiptLineSplits.js); a day with no row keeps the cut over the current lines.
 *   T14   `standalone_sale_obligations.lineRef` (NULL on every existing row): the line a `lineLowered` row was opened for (loop t2 B2-1).
 *
 * Rollback (self-update rule 31): T1-T3, T6, T7, T13, T14 are new tables or columns ignored by the previous release; T4 and T5 only add a
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
  // Money a document owes back that left no line to hold it (outside-visit spec rule 41): a link paid after the reste moved or the sale was
  // cancelled. One row per paying link; it stays open until the refund is made.
  `CREATE TABLE IF NOT EXISTS standalone_sale_obligations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    saleId        INTEGER NOT NULL,
    origin        TEXT NOT NULL CHECK (origin IN ('linkSurplus', 'lineLowered')),
    paymentLinkId INTEGER UNIQUE,
    amountCents   INTEGER NOT NULL CHECK (amountCents > 0),
    reason        TEXT,
    lineRef       TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
    settledAt     TEXT,
    settledBy     TEXT,
    FOREIGN KEY (saleId) REFERENCES standalone_sales(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_standalone_sale_obligations_sale ON standalone_sale_obligations(saleId, status)',
  // The external VAT rate of a class, set from the catalogue (owner Q-C11): `vat.rate.<class>.external` of the VAT component.
  `CREATE TABLE IF NOT EXISTS vat_external_rates (
    vatClass TEXT PRIMARY KEY,
    rate     REAL NOT NULL CHECK (rate >= 0 AND rate < 100)
  )`,
  // Rule 99 (loop t1 B-4) — the sale lines a stay's receipts of one payment day are cut over, frozen with the money (utils/receiptLineSplits.js).
  `CREATE TABLE IF NOT EXISTS receipt_line_splits (
    reservationId INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    paidDate      TEXT NOT NULL,
    linesJson     TEXT NOT NULL,
    frozenAt      TEXT NOT NULL,
    PRIMARY KEY (reservationId, paidDate)
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
    // Rules 31, 61, 63, 91 (owner 2026-11-15): the stays the sale-line readers serve — 0 on every stay booked before this version.
    ['reservations', 'readsSaleLines', 'INTEGER NOT NULL DEFAULT 0'],
    // Loop t2 B2-1 (outside-visit rule 49) — the line a `lineLowered` row was opened for (NULL: the whole document cancelled, a link surplus).
    ['standalone_sale_obligations', 'lineRef', 'TEXT'],
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
  // Bound as an integer: a JS number would store the counter as a REAL (`85.0`) — end review R1-5.
  if (sequence) db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(BigInt(Math.trunc(Number(sequence.seq))), table);
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

const DEPARTURE_GUARD = 'trg_departure_line_guard';
const DEPARTURE_GUARD_MESSAGE = 'Lignes de départ enregistrées par GuestFlow 4.2.0 : réinstaller 4.2.0 ou plus récent pour modifier cette fiche.';

/** T12 — the departure line guard and its permit table. Idempotent; on a schema without `sasLineKey` there is no departure line to guard. */
function guardDepartureLines(db) {
  if (!hasTable(db, 'reservation_custom_options') || !hasColumn(db, 'reservation_custom_options', 'sasLineKey')) return 0;
  const existed = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(DEPARTURE_GUARD));
  db.exec('CREATE TABLE IF NOT EXISTS departure_line_deletes (id INTEGER PRIMARY KEY)');
  db.exec(`CREATE TRIGGER IF NOT EXISTS ${DEPARTURE_GUARD} BEFORE DELETE ON reservation_custom_options
    WHEN COALESCE(OLD.sasLineKey, '') LIKE 'departure:%'
      AND EXISTS (SELECT 1 FROM reservations WHERE id = OLD.reservationId)
      AND NOT EXISTS (SELECT 1 FROM departure_line_deletes WHERE id = OLD.id)
    BEGIN SELECT RAISE(ABORT, '${DEPARTURE_GUARD_MESSAGE.replace(/'/g, "''")}'); END`);
  return existed ? 0 : 1;
}

/** T10 once the update that brought it is verified (rule 31) → `{ state: 'ran', tables }`, `{ state: 'awaiting' }` or `{ state: 'done' }` (it already ran). */
function runTrueLinesWhenVerified(db, { awaiting = () => require('./updateVerification').thisReleaseAwaitsVerification() } = {}) {
  if (done(db, 'pricing_sales_true_lines_v1')) return { state: 'done' };
  if (awaiting()) return { state: 'awaiting' };
  return { state: 'ran', tables: dropArticleKeys(db) };
}

// Loop t1 B-1 — a paid line of a document lowered (offered, removed, the document cancelled) owes money back with no link: origin `lineLowered`. A table
// created before that origin existed is rebuilt once with the wider CHECK, its rows and ids kept.
function widenDocumentObligations(db) {
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'standalone_sale_obligations'").get();
  if (!stored || stored.sql.includes("'lineLowered'")) return 0;
  withRebuildPragmas(db, () => db.transaction(() => {
    rebuildTable(db, 'standalone_sale_obligations', (sql) => {
      const widened = sql.replace(/origin IN \('linkSurplus'\)/, "origin IN ('linkSurplus', 'lineLowered')");
      if (widened === sql) throw new Error('PRICING_SALES_UNEXPECTED_DDL: standalone_sale_obligations');
      return widened;
    });
  })());
  return 1;
}

// `deferTrueLines`: the boot of a release its update helper has not verified yet keeps T10 for later (`runTrueLinesWhenVerified`).
function runPricingSalesMigration(db, { deferTrueLines = false } = {}) {
  const changes = {};
  changes.tables = createTables(db);
  changes.columns = addColumns(db);
  changes.rebuilt = relaxReservationId(db);
  changes.documentObligations = widenDocumentObligations(db);
  changes.departureGuard = guardDepartureLines(db);
  changes.trueLines = deferTrueLines ? 0 : dropArticleKeys(db);
  changes.trueLinesDeferred = Boolean(deferTrueLines) && !done(db, 'pricing_sales_true_lines_v1');
  return changes;
}

module.exports = {
  runPricingSalesMigration, runTrueLinesWhenVerified, backfillOrderRefs, backfillOrderRefsOnce, SCHEMA_FLOOR_VERSION, DEPARTURE_GUARD_MESSAGE,
};
