/**
 * specs/plugin-removal-resilience.md rule 22 — a plugin's table can be erased and recreated while core rows
 * still cite its ids in a text reference (`order:<id>:<n>`, `resource-booking:<id>`). The AUTOINCREMENT counter
 * of the recreated table must restart above every id still cited, or a new row would inherit an old document.
 */
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const hasColumn = (db, table, column) => hasTable(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

/** → the highest id named by `<prefix><id>` (followed by `:` or the end) in the given `{ table, column }` sources; 0 when none. */
function highestCitedId(db, prefix, sources) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)(?::|$)`);
  let highest = 0;
  for (const { table, column } of sources) {
    if (!hasColumn(db, table, column)) continue;
    const rows = db.prepare(`SELECT DISTINCT ${column} AS ref FROM ${table} WHERE ${column} LIKE ?`).all(`${prefix}%`);
    for (const { ref } of rows) {
      const match = pattern.exec(String(ref));
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest;
}

/** → the highest numeric `ref` of the payment links whose basket names `source` (a link outlives the plugin's erase and can still be paid); 0 when none. */
function highestBasketRef(db, source) {
  if (!hasColumn(db, 'payment_links', 'basketJson')) return 0;
  const row = db.prepare(`SELECT MAX(CAST(json_extract(basketJson, '$.ref') AS INTEGER)) AS highest FROM payment_links
    WHERE json_valid(basketJson) AND json_extract(basketJson, '$.source') = ?`).get(source);
  return Math.max(0, Number(row && row.highest) || 0);
}

/** Raises the AUTOINCREMENT counter of `table` to at least `floor`; never lowers it. */
function raiseCounter(db, table, floor) {
  if (!(floor > 0) || !hasTable(db, table)) return;
  const row = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
  if (!row) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, floor);
  else if (Number(row.seq) < floor) db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(floor, table);
}

module.exports = { highestCitedId, highestBasketRef, raiseCounter };
