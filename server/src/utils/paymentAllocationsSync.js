/**
 * PAYMENT ALLOCATIONS — the live writers (specs/pricing-components.md §3 rule 74).
 *
 * `payment_allocations` says which payment covered which line. The boot backfill wrote it from the stored columns; from then
 * on the application writes it as money moves: every path that ticks, unticks or edits a payment (an acompte, a solde, a
 * complement, an end of stay, a mid-stay note, an installment, a split payment, a refund) calls `syncStay` in its own
 * transaction, and the allocations of the stay are rebuilt from what the stay now stores, by the same function the backfill
 * runs (`legacyAllocations` with the stay-level option). One function, so the backfill and the live write cannot disagree.
 *
 * A trigger-fed table (`payment_allocations_dirty`) is the net under the explicit calls: any write to the columns the
 * allocations read marks the stay, whoever wrote it (a plugin, a script, a statement this module does not know about), and the
 * reader of the allocations flushes the mark first. A path that forgot its call is therefore late, never wrong.
 *
 *   syncStay(db, id)        rebuild the payment rows and the refund rows of one stay; returns the rows changed
 *   flushDirty(db, [id])    sync every marked stay (or one); returns the stays synced
 *   ensureTriggers(db)      the dirty table and its triggers (idempotent)
 *
 * Pure SQL and `legacyAllocations`: no clock, no HTTP.
 */
const { toCents: cents } = require('./pricing/money');
const { legacyAllocations } = require('./pricing/legacyAllocations');
const { extraLineKey, parseNotes, parseDetail } = require('./pricing/storedLines');
const { readComplementPaidSplit } = require('./complementPaidSplit');
const { parseRemovedLineContribs } = require('./removedLineContribs');

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

// The reservation columns the allocations read: a write to any of them marks the stay.
const WATCHED = [
  'depositPaid', 'depositPaidCash', 'depositPaidDate', 'depositAmount', 'balancePaid', 'balancePaidCash', 'balancePaidDate', 'balanceAmount',
  'complementPaid', 'complementPaidCash', 'complementPaidDate', 'complementAmount', 'complementPaidSplit',
  'endOfStayComplementPaid', 'endOfStayComplementPaidCash', 'endOfStayComplementPaidDate', 'endOfStayComplementAmount', 'endOfStayComplementDetail',
  'midStaySettledNotes', 'removedLineContribs',
  'accommodationAcompteContribTtc', 'accommodationSoldeContribTtc', 'touristTaxAcompteContribTtc', 'touristTaxSoldeContribTtc',
];

function ensureTriggers(db) {
  if (!hasTable(db, 'reservations') || !hasTable(db, 'payment_allocations')) return;
  db.exec('CREATE TABLE IF NOT EXISTS payment_allocations_dirty (reservationId INTEGER PRIMARY KEY)');
  const present = columnsOf(db, 'reservations');
  const watched = WATCHED.filter((name) => present.has(name));
  if (watched.length) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_alloc_dirty_stay_updated AFTER UPDATE OF ${watched.join(', ')} ON reservations
      BEGIN INSERT OR IGNORE INTO payment_allocations_dirty (reservationId) VALUES (NEW.id); END`);
  }
  const mark = (table, column, events) => {
    if (!hasTable(db, table) || !columnsOf(db, table).has(column)) return;
    for (const event of events) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_alloc_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON ${table}
        BEGIN INSERT OR IGNORE INTO payment_allocations_dirty (reservationId) VALUES (${row}.${column}); END`);
    }
  };
  mark('reservation_installments', 'reservationId', ['INSERT', 'UPDATE', 'DELETE']);
  mark('payment_settlements', 'reservationId', ['INSERT', 'UPDATE', 'DELETE']);
  mark('reservation_refunds', 'reservationId', ['INSERT', 'UPDATE', 'DELETE']);
  for (const table of ['reservation_options', 'reservation_resources', 'reservation_custom_options']) {
    mark(table, 'reservationId', ['INSERT', 'DELETE']);
  }
}

// Whether the legacy books route the stay's tourist tax to the arrival complement: collected by us on arrival (the platform's
// own mode says it does not collect the tax) or forced there. Read from the platform's mode, never from its name.
function taxRoutedToComplement(db, stay) {
  const { resolveGlobalPlatformTaxRow } = require('../models/pricingInputModel');
  const mode = resolveGlobalPlatformTaxRow(db, stay.platform);
  const collectedOnArrival = Number(stay.touristTaxTotal || 0) > 0 && mode != null && Number(mode.c) === 0;
  return collectedOnArrival || Number(stay.touristTaxInComplement || 0) === 1;
}

/** The payment rows the stay's stored columns describe: `[{ paymentRef, lineRef, amountCents, at, books }]`. */
function paymentRowsOfStay(db, stay, { stayLevel = true } = {}) {
  const has = (name) => hasTable(db, name);
  const lines = [
    ...db.prepare('SELECT lineId, optionId, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0').all(stay.id)
      .map((r) => ({ ref: `line:reservation_options:${r.lineId}`, key: `opt:${r.optionId}`, ...r })),
    ...db.prepare('SELECT lineId, resourceId, acompteContribTtc, soldeContribTtc FROM reservation_resources WHERE reservationId = ? AND COALESCE(offered, 0) = 0').all(stay.id)
      .map((r) => ({ ref: `line:reservation_resources:${r.lineId}`, key: `res:${r.resourceId}`, ...r })),
    ...db.prepare('SELECT lineId, description, acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = ? AND COALESCE(offered, 0) = 0').all(stay.id)
      .map((r) => ({ ref: `line:reservation_custom_options:${r.lineId}`, key: extraLineKey({ isCustom: true, description: r.description }), ...r })),
  ];
  const stayLines = { accommodation: null, touristTax: null };
  if (has('reservation_stay_lines')) {
    for (const row of db.prepare('SELECT id, kind FROM reservation_stay_lines WHERE reservationId = ?').all(stay.id)) stayLines[row.kind] = `line:reservation_stay_lines:${row.id}`;
  }
  return legacyAllocations({
    reservation: stay,
    lines,
    stayLines,
    removed: parseRemovedLineContribs(stay.removedLineContribs),
    complementSplit: readComplementPaidSplit(stay),
    endOfStayDetail: parseDetail(stay.endOfStayComplementDetail),
    notes: parseNotes(stay.midStaySettledNotes),
    installments: has('reservation_installments')
      ? db.prepare('SELECT id, paid, paidDate, amountCents, paidSplit FROM reservation_installments WHERE reservationId = ?').all(stay.id).map((r) => ({ ...r, paidSplit: parseJson(r.paidSplit) })) : [],
    settlements: has('payment_settlements')
      ? db.prepare('SELECT * FROM payment_settlements WHERE reservationId = ?').all(stay.id).map((s) => ({
        ...s,
        parts: parseJson(s.parts) || [],
        tenders: has('payment_tenders') ? db.prepare('SELECT amountCents, internal FROM payment_tenders WHERE settlementId = ?').all(s.id) : [],
      })) : [],
    stayLevel: stayLevel ? { taxRoutedToComplement: taxRoutedToComplement(db, stay) } : null,
  });
}

/**
 * The refund rows of a stay: one negative row per (refund, line), the requalification avoir and the withheld commission
 * left out (they move no money, Q-B6). `paymentRef` stays NULL: no payment is derivable from a refund (Q-B5).
 */
function refundRowsOfStay(db, reservationId) {
  if (!hasTable(db, 'reservation_refunds') || !hasTable(db, 'reservation_refund_lines') || !columnsOf(db, 'reservation_refund_lines').has('lineRef')) return [];
  const rows = [];
  for (const refund of db.prepare("SELECT id, refundDate, method FROM reservation_refunds WHERE reservationId = ? AND method <> 'retained' ORDER BY id").all(reservationId)) {
    const byLine = new Map();
    for (const line of db.prepare("SELECT lineRef, amountTtc, amountCents FROM reservation_refund_lines WHERE refundId = ? AND COALESCE(source, 'sale') <> 'commission'").all(refund.id)) {
      const key = line.lineRef || '';
      byLine.set(key, (byLine.get(key) || 0) + (line.amountCents != null ? Number(line.amountCents) : cents(line.amountTtc)));
    }
    for (const [lineRef, amount] of byLine) {
      if (amount > 0) rows.push({ paymentRef: null, lineRef: lineRef || null, amountCents: -amount, at: refund.refundDate, refundId: refund.id, books: refund.method === 'internal' ? 0 : 1 });
    }
  }
  return rows;
}

/** `Map(lineKey → lineRef | null)` of a stay: null when two lines share the key (rule 79 — a ref names one line). */
function lineRefsByKey(db, reservationId) {
  const byKey = new Map();
  const push = (key, ref) => { if (key) byKey.set(key, byKey.has(key) ? null : ref); };
  for (const row of db.prepare('SELECT lineId, optionId FROM reservation_options WHERE reservationId = ?').all(reservationId)) push(`opt:${row.optionId}`, `line:reservation_options:${row.lineId}`);
  for (const row of db.prepare('SELECT lineId, resourceId FROM reservation_resources WHERE reservationId = ?').all(reservationId)) push(`res:${row.resourceId}`, `line:reservation_resources:${row.lineId}`);
  for (const row of db.prepare('SELECT lineId, description FROM reservation_custom_options WHERE reservationId = ?').all(reservationId)) push(extraLineKey({ isCustom: true, description: row.description }), `line:reservation_custom_options:${row.lineId}`);
  if (hasTable(db, 'reservation_stay_lines')) {
    for (const row of db.prepare('SELECT id, kind FROM reservation_stay_lines WHERE reservationId = ?').all(reservationId)) push(row.kind, `line:reservation_stay_lines:${row.id}`);
  }
  return byKey;
}

const keyOf = (row) => `${row.paymentRef || ''}|${row.lineRef || ''}|${row.refundId || 0}`;

function reconcile(db, documentRef, kind, desired) {
  const existing = db.prepare('SELECT * FROM payment_allocations WHERE documentRef = ? AND kind = ?').all(documentRef, kind);
  const wanted = new Map(desired.map((row) => [keyOf(row), row]));
  const update = db.prepare('UPDATE payment_allocations SET amountCents = ?, at = ?, books = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM payment_allocations WHERE id = ?');
  const insert = db.prepare(`INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, refundId, books, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live')`);
  let changed = 0;
  const seen = new Set();
  for (const row of existing) {
    const key = keyOf(row);
    const want = wanted.get(key);
    if (!want) { changed += remove.run(row.id).changes; continue; }
    seen.add(key);
    if (Number(row.amountCents) !== want.amountCents || (row.at || null) !== (want.at || null) || Number(row.books) !== Number(want.books)) {
      changed += update.run(want.amountCents, want.at || null, want.books, row.id).changes;
    }
  }
  for (const [key, row] of wanted) {
    if (!seen.has(key)) changed += insert.run(row.paymentRef || null, documentRef, row.lineRef || null, row.amountCents, kind, row.at || null, row.refundId || null, row.books).changes;
  }
  return changed;
}

/** Rebuilds the payment and refund rows of one stay from what it stores, in the caller's transaction. Returns the rows changed. */
function syncStay(db, reservationId) {
  const id = Number(reservationId);
  if (!hasTable(db, 'payment_allocations') || !Number.isInteger(id)) return 0;
  const stay = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (hasTable(db, 'payment_allocations_dirty')) db.prepare('DELETE FROM payment_allocations_dirty WHERE reservationId = ?').run(id);
  if (!stay || !['reservation', 'cancelled'].includes(stay.kind)) return 0;
  const documentRef = `reservation:${id}`;
  return reconcile(db, documentRef, 'payment', paymentRowsOfStay(db, stay)) + reconcile(db, documentRef, 'refund', refundRowsOfStay(db, id));
}

/** Syncs every stay a write marked (or only `reservationId`). Returns the stays synced. */
function flushDirty(db, reservationId = null) {
  if (!hasTable(db, 'payment_allocations_dirty')) return 0;
  const ids = reservationId == null
    ? db.prepare('SELECT reservationId FROM payment_allocations_dirty').all().map((r) => r.reservationId)
    : db.prepare('SELECT reservationId FROM payment_allocations_dirty WHERE reservationId = ?').all(Number(reservationId)).map((r) => r.reservationId);
  for (const id of ids) syncStay(db, id);
  return ids.length;
}

module.exports = { lineRefsByKey, ensureTriggers, paymentRowsOfStay, refundRowsOfStay, syncStay, flushDirty, WATCHED };
