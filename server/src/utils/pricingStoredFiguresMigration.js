/**
 * PRICING STORED FIGURES — the stored columns a sale reads instead of re-running a unit (specs/pricing-components.md §3 rule 8;
 * owner decision 2026-11-15: in 4.2.0, with a backfill of the existing stays).
 *
 *   F1  `reservations.storedExtraGuests`, `reservations.storedTouristTax` (TEXT, JSON, NULL = not stored): what EXTRA GUESTS and
 *       TOURIST TAX gave the stay's last pricing, each with the basis it was computed on (`utils/pricing/storedSaleFigures.js`).
 *       Written by every save that prices the stay; read by `staySale`.
 *   B1  the backfill: for each live stay, what a sale on it computes TODAY — the very dry run `extraSale` prices a sale on
 *       (`performUpdate(…, { dryRun: true, sale: 'fiche' })` of the stored stay, re-priced under its own lock), rolled back, its two
 *       records written. Nothing else of the row is written, so no figure moves; a stay whose dry run is refused keeps NULL and
 *       its sales run the units as before. It needs the controller, which `database.js` cannot load: `index.js`, the replay and
 *       the price gate's recompute call `backfillSaleFiguresOnce` once the application is up.
 *
 * Idempotent: F1 adds a column only when missing; B1 runs once (`pricing_stored_sale_figures_v1`) and, re-run with `force`,
 * writes the same records (a sale on a stay that holds its records reads them back: same basis, same figures).
 * Rollback (self-update rule 31): two nullable columns the previous release neither reads nor writes. A stay it saves keeps
 * records computed on its former inputs; their basis no longer matches and the next sale runs the units, as before.
 */
const COLUMNS = [
  ['reservations', 'storedExtraGuests', 'TEXT'],
  ['reservations', 'storedTouristTax', 'TEXT'],
];
const BACKFILL_MARKER = 'pricing_stored_sale_figures_v1';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const hasColumn = (db, table, name) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);

/** F1 — the columns. Returns the number added (0 on a second run). */
function runPricingStoredFiguresMigration(db) {
  let added = 0;
  for (const [table, name, definition] of COLUMNS) {
    if (!hasTable(db, table) || hasColumn(db, table, name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    added += 1;
  }
  return added;
}

/**
 * B1 — the records of every live stay, as a sale on it computes them now. Returns `{ written, refused }` (stay ids).
 * `force` re-runs it on stays that already hold records.
 */
function backfillSaleFigures(db, { force = false } = {}) {
  if (!COLUMNS.every(([table, name]) => hasTable(db, table) && hasColumn(db, table, name))) return { written: [], refused: [] };
  const { storedBody } = require('./stayOrderLines');
  const { performUpdate } = require('../controllers/reservationsController');
  const where = force ? '' : ' AND storedExtraGuests IS NULL AND storedTouristTax IS NULL';
  const ids = db.prepare(`SELECT id FROM reservations WHERE kind = 'reservation'${where} ORDER BY id`).all().map((row) => row.id);
  const write = db.prepare('UPDATE reservations SET storedExtraGuests = ?, storedTouristTax = ? WHERE id = ?');
  const written = [];
  const refused = [];
  for (const id of ids) {
    const body = storedBody(id);
    const result = body ? performUpdate(id, { ...body, restatePricing: true }, { dryRun: true, sale: 'fiche' }) : null;
    if (!result || result.status !== 200 || !result.row) { refused.push(id); continue; }
    write.run(result.row.storedExtraGuests ?? null, result.row.storedTouristTax ?? null, id);
    written.push(id);
  }
  return { written, refused };
}

/** B1 once: `index.js`, the replay and the gate's recompute call it after the application has loaded. */
function backfillSaleFiguresOnce(db, { force = false } = {}) {
  if (!hasTable(db, 'migrations')) return { written: [], refused: [] };
  if (!force && db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(BACKFILL_MARKER)) return { written: [], refused: [] };
  const result = backfillSaleFigures(db, { force });
  db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(BACKFILL_MARKER);
  return result;
}

module.exports = { runPricingStoredFiguresMigration, backfillSaleFigures, backfillSaleFiguresOnce, BACKFILL_MARKER };
