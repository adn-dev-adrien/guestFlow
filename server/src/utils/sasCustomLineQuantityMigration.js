/**
 * A custom line the arrival SAS writes keeps its count (specs/arrival-departure-sas.md rule 29,
 * 2026-10-27 spec review). Before the `quantity` column, « Taie d'oreiller » × 2 at 3,30 € was one
 * row worth 6,60 € and every reader showed « ×1 ».
 *
 * `ensureCustomLineQuantity(db)` adds the column (idempotent) and, once, backfills the SAS rows whose
 * label is a priced linen item and whose amount is an exact multiple (> 1) of its price. A row whose
 * amount is not a clean multiple — the price changed since, or a hand-written line — stays at 1.
 */

const MIGRATION = 'sas_custom_line_quantity_v1';

function ensureCustomLineQuantity(db, { skipBackfill = false } = {}) {
  const cols = db.prepare('PRAGMA table_info(reservation_custom_options)').all().map((c) => c.name);
  if (!cols.includes('quantity')) db.exec('ALTER TABLE reservation_custom_options ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1');
  if (skipBackfill || db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return 0;
  let updated = 0;
  db.transaction(() => {
    const rows = db.prepare(`SELECT rco.id, rco.amount, lpi.price FROM reservation_custom_options rco
      JOIN linen_priced_items lpi ON TRIM(lpi.label) = TRIM(rco.description)
      WHERE COALESCE(rco.sasArrivalOrigin, 0) = 1 AND rco.quantity = 1 AND lpi.price > 0 AND rco.amount > lpi.price
      ORDER BY rco.id, lpi.id`).all();
    const set = db.prepare('UPDATE reservation_custom_options SET quantity = ? WHERE id = ?');
    const done = new Set();
    for (const row of rows) {
      if (done.has(row.id)) continue;
      const qty = Math.round(Number(row.amount) / Number(row.price));
      if (qty > 1 && Math.abs(qty * Number(row.price) - Number(row.amount)) < 0.005) {
        set.run(qty, row.id);
        done.add(row.id);
        updated += 1;
      }
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
  })();
  return updated;
}

module.exports = { ensureCustomLineQuantity, MIGRATION };
