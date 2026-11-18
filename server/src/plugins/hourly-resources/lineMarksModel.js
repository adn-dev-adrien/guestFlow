/**
 * `resource_visit_line_marks` — what the operator said of a line a prepaid instrument paid on an outside visit (rules 15, 36 of the campaigns spec):
 * « non pris », the element paid in advance that the client did not use. The line itself is never touched (the instrument's money was declared when it was
 * sold); the mark keeps who said it, when, and what the element was worth, so the screen reads it back and the instrument is told once.
 *
 *   mark({ bookingId, lineRef, label, valueCents, source, ref, by })   → the mark, or null when the line is already marked
 *   marksOf(bookingId)                                                 → `[{ lineRef, mark, label, valueCents, markedAt, markedBy }]`
 */

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS resource_visit_line_marks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bookingId  INTEGER NOT NULL,
    lineRef    TEXT NOT NULL,
    mark       TEXT NOT NULL CHECK (mark IN ('notTaken')),
    label      TEXT NOT NULL,
    valueCents INTEGER NOT NULL,
    source     TEXT,
    ref        TEXT,
    markedAt   TEXT NOT NULL,
    markedBy   TEXT,
    UNIQUE (bookingId, lineRef, mark)
  );
`;

const hasTable = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_visit_line_marks'").get());

function createLineMarksModel(db, { now = () => new Date() } = {}) {
  function mark({
    bookingId, lineRef, label, valueCents, source = null, ref = null, by = null,
  }) {
    const info = db.prepare(`INSERT OR IGNORE INTO resource_visit_line_marks (bookingId, lineRef, mark, label, valueCents, source, ref, markedAt, markedBy)
      VALUES (?, ?, 'notTaken', ?, ?, ?, ?, ?, ?)`).run(Number(bookingId), String(lineRef), label, valueCents, source, ref, now().toISOString(), by);
    return info.changes ? { lineRef, label, valueCents } : null;
  }

  const marksOf = (bookingId) => (hasTable(db)
    ? db.prepare('SELECT lineRef, mark, label, valueCents, markedAt, markedBy FROM resource_visit_line_marks WHERE bookingId = ? ORDER BY id').all(Number(bookingId))
    : []);

  return { mark, marksOf };
}

module.exports = { createLineMarksModel, CREATE_SQL };
