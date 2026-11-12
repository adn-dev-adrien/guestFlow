/**
 * PRICING LINES — the stored columns and tables that PR B of the pricing refonte reads
 * (specs/pricing-components.md §3 rules 36, 74-79, §5; owner decisions Q16).
 *
 * Everything here ADDS: a column, a table, an index, or the rebuild of a table with the same rows. No amount column is
 * rewritten (rule 36); every backfill reads stored data only and runs `WHERE <new> IS NULL` (or `NOT EXISTS`), so a
 * second run changes nothing. The two `runPricing…` entry points return what they changed, which is how the tests prove it.
 *
 *   L0  the three line tables get a stable `lineId` (rule 79): a column, a unique index and a trigger that
 *       numbers a row from a sequence that never reuses a number. The table is NOT rebuilt: its rows keep the physical order
 *       the readers that sort nothing rely on (a rowid-alias `id` would turn it into creation order), and its primary key
 *       `(reservationId, optionId)` stays, so a rolled-back release runs unchanged (self-update rule 31).
 *   L1  the sale columns of the three line tables (`collectAt`, `soldAt`, `articleRef`, `family`, `label`, …); `collectAt` is
 *       derived by `legacyCollectAt`. No `settledCents`: what a line settled is Σ of its allocations (Q-B6b).
 *   L2  `reservations.discountTarget`.            L3  `reservation_stay_lines` (« Hébergement », « Taxe de séjour »).
 *   L4  `options.vatClass`, `resources.vatClass`.
 *   S1-S11 the refund columns and `refund_obligations` / `refund_nettings`; S8 the cancellation figures.
 *   PA  `payment_allocations`: the per-line truth the stay stored, by `legacyAllocations`; refunds as negative rows.
 *
 * `runPricingLinesMigration(db)` is plain SQL and runs inside `database.js`. The nettings of S6 need the models, which
 * `database.js` cannot load while it is still loading: `backfillRefundNettings(db)` runs once the application is up
 * (`index.js`) and in the price gate's recompute.
 */
const { toCents: cents } = require('./pricing/money');
const { legacyCollectAt } = require('./pricing/legacyCollectAt');
const { paymentRowsOfStay, ensureTriggers, lineRefsByKey } = require('./paymentAllocationsSync');
const { extraLineKey } = require('./pricing/storedLines');
const { makeArticle } = require('./pricing/articles');

const quoted = (name) => `"${name}"`;

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
const hasColumns = (db, table, names) => hasTable(db, table) && names.every((name) => columnsOf(db, table).has(name));
const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

const LINE_TABLES = ['reservation_options', 'reservation_resources', 'reservation_custom_options'];
const LINE_COLUMNS = [
  ['source', "TEXT NOT NULL DEFAULT 'fiche'"], ['collectAt', 'TEXT'], ['collectAtDefault', 'TEXT'], ['soldAt', 'TEXT'], ['settlementRef', 'TEXT'],
  ['discountCents', 'INTEGER NOT NULL DEFAULT 0'], ['allowanceUsed', 'TEXT'], ['orderRef', 'TEXT'], ['vatRate', 'REAL'], ['vatClass', 'TEXT'],
  ['fulfilmentRef', 'TEXT'], ['articleRef', 'TEXT'], ['family', 'TEXT'], ['label', 'TEXT'], ['components', 'TEXT'],
];
const COLUMNS = [
  ['reservations', 'discountTarget', "TEXT NOT NULL DEFAULT 'nights'"],
  ['reservations', 'cancellationKeptCents', 'INTEGER'],
  ['reservations', 'cancellationIndemnityCents', 'INTEGER'],
  ['options', 'vatClass', 'TEXT'],
  ['resources', 'vatClass', 'TEXT'],
  ['reservation_refunds', 'kind', 'TEXT'],
  ['reservation_refunds', 'amountCents', 'INTEGER'],
  ['reservation_refunds', 'origin', 'TEXT'],
  ['reservation_refunds', 'providerRefundRef', 'TEXT'],
  ['reservation_refund_lines', 'amountCents', 'INTEGER'],
  ['reservation_refund_lines', 'source', 'TEXT'],
  ['reservation_refund_lines', 'revenueBucket', 'TEXT'],
  ['reservation_refund_lines', 'lineRef', 'TEXT'],
  ['reservation_refund_lines', 'vatClass', 'TEXT'],
  ['cancellation_compensations', 'refundId', 'INTEGER'],
];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS reservation_stay_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('accommodation', 'touristTax')),
    label TEXT NOT NULL,
    totalCents INTEGER NOT NULL,
    vatClass TEXT NOT NULL,
    vatRate REAL,
    components TEXT,
    soldAt TEXT,
    amendedAt TEXT,
    UNIQUE (reservationId, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS refund_nettings (
    avoirId INTEGER NOT NULL REFERENCES reservation_refunds(id) ON DELETE CASCADE,
    refundId INTEGER NOT NULL REFERENCES reservation_refunds(id) ON DELETE CASCADE,
    PRIMARY KEY (avoirId, refundId)
  )`,
  `CREATE TABLE IF NOT EXISTS refund_obligations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    origin TEXT NOT NULL CHECK (origin IN ('basket', 'duplicatePayment', 'withdrawnLink', 'lineLowered', 'orderConflict', 'neverBooked')),
    paymentLinkId INTEGER,
    lineRef TEXT,
    amountCents INTEGER NOT NULL CHECK (amountCents > 0),
    reason TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
    settledAt TEXT,
    settledBy TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_refund_obligations_reservation ON refund_obligations (reservationId, status)',
  `CREATE TABLE IF NOT EXISTS payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paymentRef TEXT,
    documentRef TEXT NOT NULL,
    lineRef TEXT,
    amountCents INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
    at TEXT,
    refundId INTEGER,
    books INTEGER NOT NULL DEFAULT 1 CHECK (books IN (0, 1)),
    origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('backfill', 'live'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_allocations_key
    ON payment_allocations (COALESCE(paymentRef, ''), documentRef, COALESCE(lineRef, ''), kind, COALESCE(refundId, 0))`,
  'CREATE INDEX IF NOT EXISTS idx_payment_allocations_document ON payment_allocations (documentRef)',
  // An allocation names its document by text, so no foreign key follows a deleted stay: the trigger does, like the cascades
  // of the stay's other children.
  `CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_stay_deleted AFTER DELETE ON reservations
    BEGIN DELETE FROM payment_allocations WHERE documentRef = 'reservation:' || OLD.id; END`,
];

// ── L0 — the stable line number ────────────────────────────────────────────────────────────────────────────────────
const NUMBERED = ['reservation_options', 'reservation_resources', 'reservation_custom_options'];

/** Adds `lineId`, its unique index, the sequence and the trigger; numbers the existing rows in rowid order. Returns the rows numbered. */
function numberLines(db) {
  db.exec('CREATE TABLE IF NOT EXISTS line_id_sequence (tbl TEXT PRIMARY KEY, last INTEGER NOT NULL DEFAULT 0)');
  let numbered = 0;
  for (const table of NUMBERED.filter((name) => hasTable(db, name))) {
    if (!columnsOf(db, table).has('lineId')) db.exec(`ALTER TABLE ${table} ADD COLUMN lineId INTEGER`);
    db.prepare('INSERT OR IGNORE INTO line_id_sequence (tbl, last) VALUES (?, 0)').run(table);
    // The rows already there take their rowid, which is unique; the sequence then starts above the highest number.
    numbered += db.prepare(`UPDATE ${table} SET lineId = rowid WHERE lineId IS NULL`).run().changes;
    db.prepare('UPDATE line_id_sequence SET last = MAX(last, COALESCE((SELECT MAX(lineId) FROM ' + table + '), 0)) WHERE tbl = ?').run(table);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_line_id ON ${table} (lineId)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_line_id AFTER INSERT ON ${table} WHEN NEW.lineId IS NULL
      BEGIN
        UPDATE line_id_sequence SET last = last + 1 WHERE tbl = '${table}';
        UPDATE ${table} SET lineId = (SELECT last FROM line_id_sequence WHERE tbl = '${table}') WHERE rowid = NEW.rowid;
      END`);
  }
  return numbered;
}

function addColumns(db) {
  let added = 0;
  const add = (table, name, definition) => {
    if (!hasTable(db, table) || columnsOf(db, table).has(name)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    added += 1;
  };
  for (const table of LINE_TABLES) for (const [name, definition] of LINE_COLUMNS) add(table, name, definition);
  for (const [table, name, definition] of COLUMNS) add(table, name, definition);
  return added;
}

// ── L1 — the line columns ───────────────────────────────────────────────────────────────────────────────────────────
function directChannelNames(db) {
  const names = new Set(['direct']);
  if (hasTable(db, 'platforms') && columnsOf(db, 'platforms').has('countsAsDirect')) {
    for (const row of db.prepare('SELECT name FROM platforms WHERE countsAsDirect = 1').all()) names.add(String(row.name).trim().toLowerCase());
  }
  return names;
}

function backfillLineColumns(db) {
  if (!LINE_TABLES.every((table) => hasTable(db, table) && columnsOf(db, table).has('collectAt'))) return 0;
  const pending = db.prepare(LINE_TABLES.map((table) => `SELECT reservationId FROM ${table} WHERE collectAt IS NULL`).join(' UNION ')).all().map((r) => r.reservationId);
  if (pending.length === 0) return 0;
  const direct = directChannelNames(db);
  const catalogue = {
    option: db.prepare('SELECT * FROM options WHERE id = ?'),
    resource: db.prepare('SELECT * FROM resources WHERE id = ?'),
  };
  const update = (table) => db.prepare(`UPDATE ${table} SET collectAt = ?, collectAtDefault = ?, soldAt = ?, articleRef = ?, family = ?, label = ? WHERE rowid = ? AND collectAt IS NULL`);
  const updates = { reservation_options: update('reservation_options'), reservation_resources: update('reservation_resources'), reservation_custom_options: update('reservation_custom_options') };
  let changed = 0;
  for (const reservationId of pending) {
    const stay = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    if (!stay) continue;
    const lines = [
      ...db.prepare('SELECT rowid AS rid, * FROM reservation_options WHERE reservationId = ? ORDER BY rowid').all(reservationId).map((row) => ({ table: 'reservation_options', row, kind: 'option', refKind: 'option', idKey: 'optionId' })),
      ...db.prepare('SELECT rowid AS rid, * FROM reservation_resources WHERE reservationId = ? ORDER BY rowid').all(reservationId).map((row) => ({ table: 'reservation_resources', row, kind: 'resource', refKind: 'resource', idKey: 'resourceId' })),
      ...db.prepare('SELECT rowid AS rid, * FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(reservationId).map((row) => ({ table: 'reservation_custom_options', row, kind: 'custom' })),
    ];
    const moments = legacyCollectAt(lines.map(({ row, kind, idKey }) => (kind === 'custom'
      ? { isCustom: true, description: row.description, totalPrice: row.amount, offered: row.offered, inComplement: row.inComplement }
      : { [idKey]: row[idKey], totalPrice: row.totalPrice, offered: row.offered, inComplement: row.inComplement })), {
      platformSale: !direct.has(String(stay.platform == null ? 'direct' : stay.platform).trim().toLowerCase() || 'direct'),
      baseline: stay.arrivalExtrasBaseline || null,
    });
    lines.forEach(({ table, row, kind, refKind, idKey }, index) => {
      let articleRef = `custom:${row.lineId}`;
      let family = null;
      let label = String(row.description || '').trim();
      if (kind !== 'custom') {
        const article = catalogue[refKind].get(row[idKey]);
        articleRef = `${refKind}:${row[idKey]}`;
        if (article) {
          // The line's own stored price type decides, like everywhere a stored line is read.
          family = makeArticle({ ...article, priceType: row.priceType }, { kind: refKind }).family;
          label = String(refKind === 'resource' ? article.name : article.title || '');
        } else {
          label = '';
        }
      }
      const soldAt = (kind === 'custom' && row.createdAt) || stay.createdAt || null;
      changed += updates[table].run(moments[index], moments[index], soldAt, articleRef, family, label, row.rid).changes;
    });
  }
  return changed;
}

// ── L3 — the accommodation and tourist-tax lines of a stay ──────────────────────────────────────────────────────────
function backfillStayLines(db) {
  if (!hasTable(db, 'reservation_stay_lines') || !LINE_TABLES.every((table) => hasTable(db, table))) return 0;
  const stays = db.prepare(`SELECT * FROM reservations r
    WHERE NOT EXISTS (SELECT 1 FROM reservation_stay_lines s WHERE s.reservationId = r.id AND s.kind = 'accommodation')`).all();
  const insert = db.prepare('INSERT OR IGNORE INTO reservation_stay_lines (reservationId, kind, label, totalCents, vatClass, soldAt) VALUES (?, ?, ?, ?, ?, ?)');
  const extras = db.prepare(`SELECT
      COALESCE((SELECT SUM(CAST(ROUND(totalPrice * 100) AS INTEGER)) FROM reservation_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0), 0)
    + COALESCE((SELECT SUM(CAST(ROUND(totalPrice * 100) AS INTEGER)) FROM reservation_resources WHERE reservationId = ? AND COALESCE(offered, 0) = 0), 0)
    + COALESCE((SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM reservation_custom_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0), 0) AS total`);
  let changed = 0;
  for (const stay of stays) {
    // The line is what the stay stored for the lodging: the final price less the extras it also holds (rule 74).
    const accommodation = Math.max(0, cents(stay.finalPrice) - Number(extras.get(stay.id, stay.id, stay.id).total || 0));
    changed += insert.run(stay.id, 'accommodation', 'Hébergement', accommodation, 'accommodation', stay.createdAt || null).changes;
    if (cents(stay.touristTaxTotal) > 0) changed += insert.run(stay.id, 'touristTax', 'Taxe de séjour', cents(stay.touristTaxTotal), 'outOfScope', stay.createdAt || null).changes;
  }
  return changed;
}

// ── S1-S5, S7, S8 — the refund columns ──────────────────────────────────────────────────────────────────────────────
function backfillRefundColumns(db) {
  let changed = 0;
  const run = (sql) => { changed += db.prepare(sql).run().changes; };
  if (hasTable(db, 'reservation_refunds') && columnsOf(db, 'reservation_refunds').has('kind')) {
    run("UPDATE reservation_refunds SET kind = CASE WHEN method = 'retained' THEN 'requalification' ELSE 'refund' END WHERE kind IS NULL");
    run("UPDATE reservation_refunds SET origin = CASE WHEN method = 'retained' THEN 'cancellation' ELSE 'operator' END WHERE origin IS NULL");
    run('UPDATE reservation_refunds SET amountCents = CAST(ROUND(totalTtc * 100) AS INTEGER) WHERE amountCents IS NULL');
    run('UPDATE reservation_refund_lines SET amountCents = CAST(ROUND(amountTtc * 100) AS INTEGER) WHERE amountCents IS NULL');
    run(`UPDATE reservation_refund_lines SET
        source = CASE WHEN bucket = 'indemnity' THEN 'indemnity' WHEN lineKey = 'commission' THEN 'commission' ELSE 'sale' END,
        revenueBucket = CASE
          WHEN bucket = 'indemnity' THEN CASE WHEN lineKey = 'accommodation' THEN 'accommodation' WHEN lineKey = 'touristTax' THEN 'touristTax'
            WHEN lineKey LIKE 'res:%' THEN 'resources' WHEN lineKey IS NULL THEN NULL ELSE 'options' END
          ELSE bucket END
      WHERE source IS NULL`);
    backfillRefundLineRefs(db);
  }
  if (hasTable(db, 'cancellation_compensations') && columnsOf(db, 'cancellation_compensations').has('refundId') && columnsOf(db, 'cancellation_compensations').has('origin')) {
    run(`UPDATE cancellation_compensations SET refundId = (
        SELECT r.id FROM reservation_refunds r
         WHERE r.reservationId = cancellation_compensations.reservationId AND r.method = 'retained'
           AND r.refundDate = cancellation_compensations.receivedDate
           AND CAST(ROUND(r.totalTtc * 100) AS INTEGER) = CAST(ROUND(cancellation_compensations.receivedAmount * 100) AS INTEGER)
         ORDER BY r.id DESC LIMIT 1)
      WHERE refundId IS NULL AND origin = 'retained_deposit'`);
  }
  changed += backfillCancellationFigures(db);
  return changed;
}

// S5' — a refund line points at the precise sale line when its key names exactly one line of the stay today.
function backfillRefundLineRefs(db) {
  const lines = db.prepare(`SELECT l.id, l.lineKey, r.reservationId FROM reservation_refund_lines l JOIN reservation_refunds r ON r.id = l.refundId
    WHERE l.lineRef IS NULL AND l.lineKey IS NOT NULL`).all();
  const update = db.prepare('UPDATE reservation_refund_lines SET lineRef = ? WHERE id = ? AND lineRef IS NULL');
  const refsOf = new Map();
  const refsFor = (reservationId) => {
    if (!refsOf.has(reservationId)) refsOf.set(reservationId, lineRefsByKey(db, reservationId));
    return refsOf.get(reservationId);
  };
  let changed = 0;
  for (const line of lines) {
    const ref = refsFor(line.reservationId).get(line.lineKey);
    if (ref) changed += update.run(ref, line.id).changes;
  }
  return changed;
}

// S8 — what the cancellation kept, read from the `cancel` history entry (`keptFromGuest`, else `retainedDeposit`).
function backfillCancellationFigures(db) {
  if (!hasColumns(db, 'reservations', ['kind', 'cancellationKeptCents']) || !hasTable(db, 'reservation_history')) return 0;
  let changed = 0;
  const stays = db.prepare("SELECT id FROM reservations WHERE kind = 'cancelled' AND cancellationKeptCents IS NULL").all();
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'cancel' ORDER BY id DESC LIMIT 1");
  const avoir = hasTable(db, 'reservation_refunds')
    ? db.prepare("SELECT totalTtc FROM reservation_refunds WHERE reservationId = ? AND method = 'retained' ORDER BY id DESC LIMIT 1") : null;
  const set = db.prepare('UPDATE reservations SET cancellationKeptCents = ?, cancellationIndemnityCents = ? WHERE id = ? AND cancellationKeptCents IS NULL');
  for (const { id } of stays) {
    const row = entry.get(id);
    const fields = row ? parseJson(row.changedFields) : null;
    const valueOf = (field) => {
      const change = (Array.isArray(fields) ? fields : []).find((c) => c && c.field === field);
      return change && change.to != null && Number.isFinite(Number(change.to)) ? Number(change.to) : null;
    };
    const kept = valueOf('keptFromGuest') != null ? valueOf('keptFromGuest') : valueOf('retainedDeposit');
    if (kept == null) continue;
    const indemnity = avoir ? avoir.get(id) : null;
    changed += set.run(Math.max(0, cents(kept)), indemnity ? cents(indemnity.totalTtc) : 0, id).changes;
  }
  return changed;
}

// ── S9 — the refunds owed ───────────────────────────────────────────────────────────────────────────────────────────
function backfillObligations(db) {
  if (!hasTable(db, 'refund_obligations') || !hasTable(db, 'payment_links')) return 0;
  const columns = columnsOf(db, 'payment_links');
  let changed = 0;
  const exists = db.prepare('SELECT 1 FROM refund_obligations WHERE paymentLinkId = ? AND origin = ?');
  const insert = db.prepare(`INSERT INTO refund_obligations (reservationId, origin, paymentLinkId, amountCents, createdAt, status, settledAt, settledBy)
    VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, NULL, ?)`);
  if (columns.has('basketJson')) {
    for (const link of db.prepare("SELECT id, reservationId, amountCents, paidAt, createdAt, basketJson FROM payment_links WHERE basketJson LIKE '%refundOwed%'").all()) {
      const basket = parseJson(link.basketJson);
      if (!basket || basket.refundOwed !== true || exists.get(link.id, 'basket')) continue;
      const owed = Number.isInteger(basket.refundCents) && basket.refundCents > 0 ? basket.refundCents : Number(link.amountCents);
      if (owed > 0) changed += insert.run(link.reservationId, 'basket', link.id, owed, link.paidAt || link.createdAt, 'open', null).changes;
    }
  }
  if (columns.has('cancelReason')) {
    for (const link of db.prepare("SELECT id, reservationId, amountCents, paidAt, createdAt FROM payment_links WHERE cancelReason = 'refunded'").all()) {
      if (exists.get(link.id, 'withdrawnLink') || Number(link.amountCents) <= 0) continue;
      changed += insert.run(link.reservationId, 'withdrawnLink', link.id, Number(link.amountCents), link.paidAt || link.createdAt, 'settled', 'provider').changes;
    }
  }
  return changed;
}

// ── PA — the allocations of the per-line truth, and the refunds as negative rows ─────────────────────────────────────
function backfillAllocations(db, { stayLevel = false } = {}) {
  if (!hasTable(db, 'payment_allocations') || !hasColumns(db, 'reservations', ['kind'])) return 0;
  const stays = db.prepare("SELECT * FROM reservations WHERE kind IN ('reservation', 'cancelled')").all();
  const existing = db.prepare("SELECT 1 FROM payment_allocations WHERE documentRef = ? AND paymentRef = ? AND kind = 'payment' LIMIT 1");
  const insert = db.prepare(`INSERT OR IGNORE INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, refundId, books, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'backfill')`);
  let changed = 0;
  for (const stay of stays) {
    const documentRef = `reservation:${stay.id}`;
    const rows = paymentRowsOfStay(db, stay, { stayLevel });
    // A payment already allocated (by an earlier run, or by the application itself) is never written twice.
    const fresh = [...new Set(rows.map((row) => row.paymentRef))].filter((paymentRef) => !existing.get(documentRef, paymentRef));
    for (const row of rows.filter((r) => fresh.includes(r.paymentRef))) {
      changed += insert.run(row.paymentRef, documentRef, row.lineRef, row.amountCents, 'payment', row.at, null, row.books).changes;
    }
  }
  if (!stayLevel) changed += backfillRefundAllocations(db);
  return changed;
}

/**
 * The stay-level rows of the paid buckets, notes and installments no per-line truth describes (rule 74). Needs the models for
 * the tourist-tax routing, so it runs beside `backfillRefundNettings`, once the application is up. Writes nothing already
 * allocated; a second run changes nothing.
 */
function backfillStayLevelAllocations(db) {
  return backfillAllocations(db, { stayLevel: true });
}

// A refund is a negative allocation per line, naming no payment when none is derivable (Q-B5). The requalification avoir
// moves no money and writes none (Q-B6); a withheld commission goes to the guest nowhere.
function backfillRefundAllocations(db) {
  if (!hasTable(db, 'reservation_refunds') || !hasColumns(db, 'reservation_refund_lines', ['lineRef'])) return 0;
  const insert = db.prepare(`INSERT OR IGNORE INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, refundId, books, origin)
    VALUES (NULL, ?, ?, ?, 'refund', ?, ?, ?, 'backfill')`);
  let changed = 0;
  for (const refund of db.prepare("SELECT id, reservationId, refundDate, method FROM reservation_refunds WHERE method <> 'retained' ORDER BY id").all()) {
    const byLine = new Map();
    for (const line of db.prepare("SELECT lineRef, amountCents FROM reservation_refund_lines WHERE refundId = ? AND COALESCE(source, 'sale') <> 'commission'").all(refund.id)) {
      const key = line.lineRef || '';
      byLine.set(key, (byLine.get(key) || 0) + Number(line.amountCents || 0));
    }
    for (const [lineRef, amount] of byLine) {
      if (amount > 0) changed += insert.run(`reservation:${refund.reservationId}`, lineRef || null, -amount, refund.refundDate, refund.id, refund.method === 'internal' ? 0 : 1).changes;
    }
  }
  return changed;
}

/** Schema and SQL-only backfills; idempotent. Returns what it changed (all zero on a second run). */
function runPricingLinesMigration(db) {
  const changes = {};
  changes.lineIds = numberLines(db);
  changes.columns = addColumns(db);
  if (hasTable(db, 'reservations')) for (const statement of TABLES) db.exec(statement);
  ensureTriggers(db);
  db.transaction(() => {
    changes.lineColumns = backfillLineColumns(db);
    changes.stayLines = backfillStayLines(db);
    changes.refundColumns = backfillRefundColumns(db);
    changes.obligations = backfillObligations(db);
    changes.allocations = backfillAllocations(db);
  })();
  return changes;
}

/**
 * S6 — for each requalification avoir, the refunds it netted, as `cancellationNettedRefundIds` reads them today, written
 * once. Needs the models, so it runs after the application has loaded (`index.js`, the gate's recompute); `force` re-runs it.
 */
function backfillRefundNettings(db, { force = false } = {}) {
  if (!hasTable(db, 'refund_nettings') || !hasTable(db, 'reservation_refunds')) return 0;
  const done = 'pricing_refund_nettings_v1';
  if (!force && db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(done)) return 0;
  const { cancellationNettedRefundIds } = require('./cancelReservation');
  const reservationsModel = require('../models/reservationsModel');
  const installmentsModel = require('../models/installmentsModel');
  const refundsModel = require('../models/refundsModel').createModel(db);
  const vatRegimeModel = require('../models/vatRegimeModel');
  const insert = db.prepare('INSERT OR IGNORE INTO refund_nettings (avoirId, refundId) VALUES (?, ?)');
  let changed = 0;
  for (const { reservationId } of db.prepare("SELECT DISTINCT reservationId FROM reservation_refunds WHERE method = 'retained'").all()) {
    const stay = reservationsModel.getForCancellation(Number(reservationId));
    if (!stay) continue;
    const refunds = refundsModel.listByReservation(Number(reservationId));
    const avoir = refunds.filter((r) => r.method === 'retained').reduce((best, r) => (Number(r.id) > Number(best.id) ? r : best));
    const netted = cancellationNettedRefundIds({ database: db, reservationsModel, installmentsModel }, Number(reservationId), refunds, vatRegimeModel.rateForRow(db, stay));
    for (const refundId of netted || []) changed += insert.run(avoir.id, refundId).changes;
  }
  db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(done);
  return changed;
}

module.exports = {
  runPricingLinesMigration, backfillRefundNettings, backfillStayLevelAllocations, LINE_COLUMNS, LINE_TABLES,
};
