/**
 * Suggested articles model — sole DB access for `suggested_articles` (the outside-visit spec rules 36-37).
 *
 * One ordered list of article references per sale context `(contextKind, contextId)`: the generic « Proposés à l'arrivée » lists. The rows are core data and stay
 * when the plugin that declared a kind goes off (they reappear on re-enable); reading is a pure read, and a reference that left the catalogue is dropped by the reader,
 * never from the stored list.
 *
 *   listFor(kind, id)                  → [articleRef] in position order
 *   replace(kind, id, articleRefs)     → the stored list, written whole in one transaction (positions 0…n-1)
 */
const database = () => require('../database');

function listFor(kind, id) {
  return database().prepare('SELECT articleRef FROM suggested_articles WHERE contextKind = ? AND contextId = ? ORDER BY position, id')
    .all(String(kind), String(id)).map((row) => row.articleRef);
}

function replace(kind, id, articleRefs) {
  const db = database();
  db.transaction(() => {
    db.prepare('DELETE FROM suggested_articles WHERE contextKind = ? AND contextId = ?').run(String(kind), String(id));
    const insert = db.prepare('INSERT INTO suggested_articles (contextKind, contextId, articleRef, position) VALUES (?, ?, ?, ?)');
    articleRefs.forEach((ref, position) => insert.run(String(kind), String(id), String(ref), position));
  })();
  return listFor(kind, id);
}

module.exports = { listFor, replace };
