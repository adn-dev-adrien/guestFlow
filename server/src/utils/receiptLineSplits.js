/**
 * RECEIPT LINE SPLITS — the sale lines a stay's receipts of one day are cut over, frozen when the money is taken
 * (specs/pricing-components.md §3 rule 99, stabilisation loop t1 B-4; completes rule 63 as amended by R2-5).
 *
 * The VAT cut of a receipt on a stay the sale-line readers serve weighs the VAT classes of a family by the stay's sale lines
 * (`receiptLineCut.cutReceipt`). Read from the CURRENT lines, a paid line removed or offered later would re-cut a month already
 * declared. So the lines are frozen per (stay, payment day) by `paymentAllocationsSync.syncStay`, which runs the first time the stay's allocations are read
 * after a payment marked it dirty (`payment_allocations_dirty` → `flushDirty`; loop t2 B2-6):
 *
 *   - a day is frozen the first time a payment dated that day is seen, with the lines sold by that day as they stand
 *     (`[{ ref, kind, vatClass, totalCents }]`, the fields the cut reads);
 *   - while that day is TODAY the row follows the lines (a second payment of the day after a sale of the day is cut over it, as before);
 *   - once the day is past, the row never changes: the journal reads it for every receipt of that day;
 *   - a day that no longer holds any payment (a receipt unticked) loses its row, so a payment dated that day again is frozen afresh.
 *
 * Only stays with `readsSaleLines = 1`: a stay booked before 4.2.0 is never frozen and its months never move (owner 2026-11-15).
 * A day with no row (a receipt taken before this table existed) is cut over the current lines sold by its day, exactly as before.
 *
 *   freezeStay(db, stay, paidDays, { today, linesOf })   → rows written or removed
 * The journal reads the rows through its own read model (accounting-export `accountingModel.frozenSplitsOf`, `receiptCutOf`).
 */
const { readsSaleLines } = require('./saleLinesReaders');
const { localIsoDate, todayIso } = require('./localDate');

const TABLE = 'receipt_line_splits';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const hasTable = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE));

const soldBy = (day) => (line) => !line.soldAt || localIsoDate(new Date(line.soldAt)) <= day;
const frozenLine = (line) => ({ ref: line.ref || null, kind: line.kind, vatClass: line.vatClass || null, totalCents: Math.round(Number(line.totalCents || 0)) });

// null when the stay cannot be read as a sale: nothing is frozen then, the day keeps the fallback cut.
const defaultLinesOf = (id) => {
  const detail = require('./extraSale').saleDetailOf(id);
  return detail && Array.isArray(detail.lines) ? detail.lines : null;
};

// Reading the sale detail may flush the stay's allocations again: a stay already being frozen is not frozen twice.
const inProgress = new Set();

function freezeStay(db, stay, paidDays, { today = todayIso(), linesOf = defaultLinesOf } = {}) {
  if (!stay || !readsSaleLines(stay) || !hasTable(db)) return 0;
  const days = new Set([...paidDays].map((day) => String(day || '').slice(0, 10)).filter((day) => DAY.test(day)));
  const stored = new Map(db.prepare(`SELECT paidDate, linesJson FROM ${TABLE} WHERE reservationId = ?`).all(stay.id).map((row) => [row.paidDate, row.linesJson]));
  let changed = 0;
  for (const day of stored.keys()) {
    if (!days.has(day)) changed += db.prepare(`DELETE FROM ${TABLE} WHERE reservationId = ? AND paidDate = ?`).run(stay.id, day).changes;
  }
  const wanted = [...days].filter((day) => !stored.has(day) || day === today);
  if (!wanted.length) return changed;
  if (inProgress.has(stay.id)) return changed;
  let lines;
  inProgress.add(stay.id);
  try { lines = linesOf(stay.id); } catch { lines = null; } finally { inProgress.delete(stay.id); }
  if (!Array.isArray(lines)) return changed;
  const write = db.prepare(`INSERT INTO ${TABLE} (reservationId, paidDate, linesJson, frozenAt) VALUES (?, ?, ?, ?)
    ON CONFLICT (reservationId, paidDate) DO UPDATE SET linesJson = excluded.linesJson, frozenAt = excluded.frozenAt`);
  for (const day of wanted) {
    const json = JSON.stringify(lines.filter(soldBy(day)).map(frozenLine));
    if (stored.get(day) === json) continue;
    changed += write.run(stay.id, day, json, new Date().toISOString()).changes;
  }
  return changed;
}

module.exports = { freezeStay, TABLE };
