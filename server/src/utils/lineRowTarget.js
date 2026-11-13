/**
 * LINE ROW TARGET — the SQL that addresses ONE stored line when a writer knows an article, not a line
 * (specs/pricing-components.md §3 rule 85: the line tables have no article key, a stay may hold two rows of one article).
 *
 * `articleRowWhere(db, table, articleColumn, { sasFirst })` is a WHERE clause binding `(reservationId, articleId)` in that order, in place of
 * `reservationId = ? AND optionId = ?`. It matches the article's FIRST line (the lowest `lineId`, the one every legacy key names); with
 * `sasFirst` the line the arrival SAS wrote (`sasArrivalOrigin = 1`) wins over a line sold elsewhere. On a stay holding one row it matches
 * that row, exactly as the old clause did; a schema that predates `lineId` keeps the old clause.
 *
 * `hasLineId(db, table)` is the column probe the other line writers share.
 */

const cache = new WeakMap();

function hasLineId(db, table) {
  let tables = cache.get(db);
  if (!tables) { tables = new Map(); cache.set(db, tables); }
  if (!tables.has(table)) {
    let present = false;
    try { present = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'lineId'); } catch { present = false; }
    tables.set(table, present);
  }
  return tables.get(table);
}

function articleRowWhere(db, table, articleColumn, { sasFirst = false } = {}) {
  if (!hasLineId(db, table)) return `reservationId = ? AND ${articleColumn} = ?`;
  const order = sasFirst ? 'COALESCE(sasArrivalOrigin, 0) DESC, lineId' : 'lineId';
  return `lineId = (SELECT lineId FROM ${table} WHERE reservationId = ? AND ${articleColumn} = ? ORDER BY ${order} LIMIT 1)`;
}

module.exports = { hasLineId, articleRowWhere };
