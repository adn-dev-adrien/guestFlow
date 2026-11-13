/**
 * LINE KEYS — how a sold line is named when an article can be sold more than once on a stay
 * (specs/pricing-components.md §3 rule 85, « Line key scheme »).
 *
 * Contract:
 *   `lineRef(table, lineId)`          `line:<table>:<lineId>`, the name of ONE stored line (rule 79).
 *   `parseLineRef(key)`               `{ table, lineId }` or null for any other key.
 *   `keyLines(table, rows)`           the rows of one table in their order, each with its `key` and `first`: the FIRST line of an article (the
 *                                     lowest `lineId`) keeps the legacy key `opt:<id>` / `res:<id>` (every stored baseline, note and
 *                                     allocation reads unchanged); every later line of that article is `line:<table>:<lineId>`.
 *   `resolveLineKey(lines, key)`      a `line:` key → itself when the stay holds that line; a legacy `opt:` / `res:` key → the `line:` key of the
 *                                     article's first line; a legacy key whose article has no line, and anything else → null.
 *   `articleKeyOf(lines, key)`        the reverse, for the readers that aggregate per article on purpose: `line:` → the article's legacy key.
 *   `isResourceKey(key)`              whether a key (legacy or line ref) names a resource line.
 *   `lineIdentityOf(table, ...)`      the `{ lineId, lineKey }` an engine line carries when it is NOT the first of its article ({} otherwise).
 *
 * `lines` = `[{ table, lineId, optionId | resourceId }]`. Pure: no DB, no clock, no settings; imports nothing.
 */

const ARTICLE_FIELD = { reservation_options: 'optionId', reservation_resources: 'resourceId' };
const PREFIX = { reservation_options: 'opt', reservation_resources: 'res' };

const lineRef = (table, lineId) => `line:${table}:${Number(lineId)}`;

function parseLineRef(key) {
  const match = /^line:([a-z_]+):(\d+)$/.exec(String(key || ''));
  return match ? { table: match[1], lineId: Number(match[2]) } : null;
}

function articleKey(table, row) {
  const field = ARTICLE_FIELD[table];
  return field && row && row[field] != null ? `${PREFIX[table]}:${Number(row[field])}` : null;
}

function keyLines(table, rows) {
  const firstId = new Map();
  for (const row of rows || []) {
    const article = articleKey(table, row);
    if (article == null || row.lineId == null) continue;
    const id = Number(row.lineId);
    if (!firstId.has(article) || id < firstId.get(article)) firstId.set(article, id);
  }
  const seen = new Set();
  return (rows || []).map((row) => {
    const article = articleKey(table, row);
    const first = row.lineId == null
      ? article != null && !seen.has(article)
      : article != null && Number(row.lineId) === firstId.get(article);
    if (article != null) seen.add(article);
    return { row, key: first || row.lineId == null ? article : lineRef(table, row.lineId), first };
  });
}

function lineIdentityOf(table, row, rows) {
  const keyed = keyLines(table, rows).find((entry) => entry.row === row);
  return keyed && !keyed.first && row.lineId != null ? { lineId: Number(row.lineId), lineKey: lineRef(table, row.lineId) } : {};
}

function resolveLineKey(lines, key) {
  const text = String(key || '');
  const ref = parseLineRef(text);
  if (ref) return (lines || []).some((line) => line.table === ref.table && Number(line.lineId) === ref.lineId) ? text : null;
  for (const table of Object.keys(PREFIX)) {
    if (!text.startsWith(`${PREFIX[table]}:`)) continue;
    const rows = (lines || []).filter((line) => line.table === table && articleKey(table, line) === text && line.lineId != null);
    if (rows.length === 0) return null;
    return lineRef(table, Math.min(...rows.map((line) => Number(line.lineId))));
  }
  return null;
}

function articleKeyOf(lines, key) {
  const ref = parseLineRef(key);
  if (!ref) return String(key || '') || null;
  const line = (lines || []).find((l) => l.table === ref.table && Number(l.lineId) === ref.lineId);
  return line ? articleKey(ref.table, line) : null;
}

// The bucket a line key belongs to: a resource (`res:<id>` or `line:reservation_resources:<id>`) or an option.
const isResourceKey = (key) => /^(res:|line:reservation_resources:)/.test(String(key || ''));

module.exports = { isResourceKey, ARTICLE_FIELD, lineRef, parseLineRef, keyLines, lineIdentityOf, resolveLineKey, articleKeyOf };
