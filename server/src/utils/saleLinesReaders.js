/**
 * Which stays the sale-line readers serve (specs/pricing-components.md §3 rules 31, 61, 63, 67, 91; owner reading of 2026-11-15).
 *
 * Owner, 2026-11-15: « il faut éviter de toucher les anciens séjours ou les séjours déjà réservés. Mais si c'est pour une correction
 * d'erreur je suis d'accord pour le faire ». The readers that read the sale lines — the finance pages' earnings and HT, the VAT cut of
 * each receipt on the books, the payment-link baskets — serve the stays booked once 4.2.0 is installed. A stay booked before keeps
 * today's figures for its whole life (its next links, its receipts, its declared months). The cut is per STAY, by its booking: one
 * column, `reservations.readsSaleLines`, 0 on every row the migration finds and on any row written without it, 1 on a stay or a devis
 * the application creates from then on (`markReadsSaleLines`), carried from a devis to its reservation and back.
 *
 *   readsSaleLines(row)                 → true when the row says so
 *   markReadsSaleLines(database, id, v) → stores the flag (1 by default); a database without the column (a hand-built test schema) is left as is
 */
const hasColumnMemo = new WeakMap();

function hasFlagColumn(database) {
  if (!hasColumnMemo.has(database)) {
    let present = false;
    try { present = database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'readsSaleLines'); } catch { present = false; }
    hasColumnMemo.set(database, present);
  }
  return hasColumnMemo.get(database);
}

const readsSaleLines = (row) => Number((row && row.readsSaleLines) || 0) === 1;

function markReadsSaleLines(database, id, value = 1) {
  if (!hasFlagColumn(database)) return false;
  database.prepare('UPDATE reservations SET readsSaleLines = ? WHERE id = ?').run(value ? 1 : 0, Number(id));
  return true;
}

module.exports = { readsSaleLines, markReadsSaleLines, hasFlagColumn };
