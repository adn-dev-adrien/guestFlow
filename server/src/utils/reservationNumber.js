/**
 * Reservation number generation (specs/reservation-number-and-search.md §3).
 *
 * Human-readable identifier for `kind = 'reservation'` rows, format `AAAAMM###` (year + month + a
 * per-month counter, NO separators) — an INDEPENDENT sequence (it scans `reservationNumber`, never
 * `devisNumber`). Pure helpers: they take the `db` handle (so the model, the boot backfill, and tests
 * all share one implementation) and never assume a clock — `now` is injectable. Generation does NOT
 * write; the backfill, repair, assign and reformat helpers are the only writers here.
 */

function pad2(n) { return String(n).padStart(2, '0'); }

// `AAAAMM` prefix for a date (6 digits, no separators). Accepts a Date (live generation, local month —
// matching generateDevisNumber) or a stored ISO/SQLite string like `2026-06-18 12:30:00` (backfill),
// whose leading `YYYY-MM` is sliced verbatim to avoid cross-engine `new Date('… …')` parsing quirks.
function monthPrefix(date) {
  if (typeof date === 'string') {
    const m = date.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}${m[2]}`;
  }
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`;
}

// Next free `AAAAMM###` for a month prefix: max existing counter + 1, zero-padded to 3 digits. The
// counter is the all-digit suffix after the 6-digit prefix; operator numbers that do not fit that shape
// are ignored. Every row that carries a number counts, whatever its kind: a cancelled stay KEEPS its
// number (kind = 'cancelled') and the unique index covers it, so skipping it handed the same number out
// again and every creation failed until the month changed (specs/reservation-number-and-search.md
// rule 13). The max is numeric, not lexical, so a 1000th stay of the month still follows the 999th.
function nextNumberForPrefix(db, prefix) {
  const rows = db.prepare(
    'SELECT reservationNumber FROM reservations WHERE reservationNumber LIKE ?',
  ).all(`${prefix}%`);
  let max = 0;
  for (const { reservationNumber } of rows) {
    const counter = String(reservationNumber).slice(prefix.length);
    if (!/^\d+$/.test(counter)) continue;
    max = Math.max(max, parseInt(counter, 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// Live generation for "now" (or an injected date). Used at reservation creation + devis→reservation
// conversion when the row has no number yet.
function generateReservationNumber(db, { now } = {}) {
  return nextNumberForPrefix(db, monthPrefix(now || new Date()));
}

// Assign a generated number to a kind='reservation' row that lacks one. No-op when the column is
// absent (minimal test schemas), the row is a devis, or it already has a number. The single helper
// every "side" insert path (iCal import, devis→reservation conversion) calls so EVERY reservation
// ends up numbered — not just those created through the main form. Returns true if it assigned one.
function assignReservationNumberIfMissing(db, reservationId) {
  let hasCol;
  try { hasCol = db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'reservationNumber'); }
  catch { return false; }
  if (!hasCol) return false;
  const row = db.prepare('SELECT reservationNumber, kind FROM reservations WHERE id = ?').get(reservationId);
  if (!row || row.kind !== 'reservation' || row.reservationNumber) return false;
  db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?').run(generateReservationNumber(db), reservationId);
  return true;
}

// One-shot boot backfill: give a number to every `kind = 'reservation'` row that lacks one, grouped
// by the month of its `createdAt`, sequential within the month ordered by `createdAt, id`. Idempotent
// (only NULL/empty rows are touched); re-querying the max after each write keeps multi-month batches
// correct. Returns the count assigned.
function backfillReservationNumbers(db) {
  const rows = db.prepare(
    "SELECT id, createdAt FROM reservations WHERE kind = 'reservation' AND (reservationNumber IS NULL OR reservationNumber = '') ORDER BY datetime(createdAt), id",
  ).all();
  const stamps = db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'numberRepairedAt');
  // Rule 15 — stamped, so the dashboard lists the stay until the operator has checked it.
  const update = stamps
    ? db.prepare("UPDATE reservations SET reservationNumber = ?, numberRepairedAt = datetime('now') WHERE id = ?")
    : db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?');
  let assigned = 0;
  for (const row of rows) {
    const number = nextNumberForPrefix(db, monthPrefix(row.createdAt || new Date()));
    update.run(number, row.id);
    assigned += 1;
  }
  return assigned;
}

// One-shot reformat: strip the separators from numbers still in the ORIGINAL `AAAA-MM-###` shape
// (e.g. `2026-06-001` → `202606001`). Operator-customised or otherwise non-conforming numbers are left
// untouched (the GLOB matches the original format exactly). A row is skipped when its de-hyphenated
// value would collide with an existing number (the partial unique index stays satisfied). Returns the
// count reformatted. Idempotent (after the run, no value matches the hyphenated GLOB any more).
function dehyphenateReservationNumbers(db) {
  const info = db.prepare(`
    UPDATE reservations
       SET reservationNumber = REPLACE(reservationNumber, '-', ''), updatedAt = datetime('now')
     WHERE kind = 'reservation'
       AND reservationNumber GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9]'
       AND NOT EXISTS (
         SELECT 1 FROM reservations r2
         WHERE r2.reservationNumber = REPLACE(reservations.reservationNumber, '-', '')
       )
  `).run();
  return info.changes;
}

// One-shot repair (specs/reservation-number-and-search.md rule 14): a stay left without a number by
// the collision of rule 13 gets one now, and is reported so the operator can check it. Such a row may
// be a ghost — an insert that went through while the request failed — so it is listed (and its
// history says so), never deleted: only the operator can tell a ghost from a real stay. Idempotent (only numberless rows are touched).
// Returns the repaired rows `{ id, reservationNumber, propertyId, startDate, endDate }`.
function repairNumberlessReservations(db) {
  const rows = db.prepare(
    "SELECT id, createdAt, propertyId, startDate, endDate FROM reservations WHERE kind = 'reservation' AND (reservationNumber IS NULL OR reservationNumber = '') ORDER BY datetime(createdAt), id",
  ).all();
  const stamps = db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'numberRepairedAt');
  // Rule 15 — stamped, so the dashboard lists the stay until the operator has checked it.
  const update = stamps
    ? db.prepare("UPDATE reservations SET reservationNumber = ?, numberRepairedAt = datetime('now') WHERE id = ?")
    : db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?');
  const hasHistory = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservation_history'").get());
  const history = hasHistory
    ? db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
    : null;
  return rows.map((row) => {
    const number = nextNumberForPrefix(db, monthPrefix(row.createdAt || new Date()));
    update.run(number, row.id);
    if (history) {
      history.run(row.id, JSON.stringify([
        { field: 'reservationNumber', label: 'N° de réservation', from: null, to: `${number} (attribué par réparation)` },
      ]));
    }
    return { id: row.id, reservationNumber: number, propertyId: row.propertyId, startDate: row.startDate, endDate: row.endDate };
  });
}

module.exports = {
  repairNumberlessReservations,
  monthPrefix,
  nextNumberForPrefix,
  generateReservationNumber,
  assignReservationNumberIfMissing,
  backfillReservationNumbers,
  dehyphenateReservationNumbers,
};
