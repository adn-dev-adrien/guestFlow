/**
 * Reservation number generation (specs/reservation-number-and-search.md §3).
 *
 * Human-readable identifier for `kind = 'reservation'` rows, format `AAAA-MM-###` with a per-month
 * counter — the same scheme as `devisNumber`, but an INDEPENDENT sequence (it scans
 * `reservationNumber`, never `devisNumber`). Pure helpers: they take the `db` handle (so the model,
 * the boot backfill, and tests all share one implementation) and never assume a clock — `now` is
 * injectable. Generation does NOT write; `backfillReservationNumbers` is the only writer here.
 */

function pad2(n) { return String(n).padStart(2, '0'); }

// `AAAA-MM-` prefix for a date. Accepts a Date (live generation, local month — matching
// generateDevisNumber) or a stored ISO/SQLite string like `2026-06-18 12:30:00` (backfill), whose
// leading `YYYY-MM` is sliced verbatim to avoid cross-engine `new Date('… …')` parsing quirks.
function monthPrefix(date) {
  if (typeof date === 'string') {
    const m = date.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-`;
  }
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-`;
}

// Next free `AAAA-MM-###` for a month prefix: max existing counter + 1, zero-padded to 3 digits.
// Zero-padding keeps the lexical DESC sort numeric (same constraint as devisNumber).
function nextNumberForPrefix(db, prefix) {
  const existing = db.prepare(
    "SELECT reservationNumber FROM reservations WHERE kind = 'reservation' AND reservationNumber LIKE ? ORDER BY reservationNumber DESC LIMIT 1",
  ).get(`${prefix}%`);
  let increment = 1;
  if (existing && existing.reservationNumber) {
    const parts = String(existing.reservationNumber).split('-');
    increment = parseInt(parts[2] || '0', 10) + 1;
  }
  return `${prefix}${String(increment).padStart(3, '0')}`;
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
  const update = db.prepare('UPDATE reservations SET reservationNumber = ? WHERE id = ?');
  let assigned = 0;
  for (const row of rows) {
    const number = nextNumberForPrefix(db, monthPrefix(row.createdAt || new Date()));
    update.run(number, row.id);
    assigned += 1;
  }
  return assigned;
}

module.exports = {
  monthPrefix,
  nextNumberForPrefix,
  generateReservationNumber,
  assignReservationNumberIfMissing,
  backfillReservationNumbers,
};
