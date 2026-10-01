/**
 * Removal of « Objets oubliés » (specs/guest-email-sequence.md rule 33, removed 2026-09-28).
 *
 * Two idempotent steps:
 *   - `runStripLostItemsTokenMigration` — the stored templates (body / bodyEn) lose their
 *     `{{lostItemsParagraph}}` token. Left in place it would render as an empty string (the renderer
 *     never leaks an unknown token) but leave a double blank line in the J+1 email and a « variable
 *     manquante » chip in the preview. Operators may have edited those templates, so only the token
 *     and the blank line it leaves behind are removed — never any other text.
 *   - `dropLostItemsColumn` — `reservations.lostItems` goes; it was empty on every production row.
 */

const TOKEN_LINE_RE = /^[ \t]*\{\{\s*lostItemsParagraph\s*\}\}[ \t]*\r?$/;
const TOKEN_RE = /[ \t]?\{\{\s*lostItemsParagraph\s*\}\}/g;
const isBlank = (line) => /^[ \t]*\r?$/.test(line);

/** Returns the text without the token, or null when it holds none. */
function stripLostItemsToken(text) {
  const source = String(text || '');
  if (!/\{\{\s*lostItemsParagraph\s*\}\}/.test(source)) return null;
  const lines = source.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!TOKEN_LINE_RE.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    // A paragraph of its own: drop it with the blank line that separated it from the next one, or,
    // when it closes the body, with the blank line before it.
    if (i + 1 < lines.length && isBlank(lines[i + 1])) i += 1;
    else if (kept.length && isBlank(kept[kept.length - 1])) kept.pop();
  }
  return kept.join('\n').replace(TOKEN_RE, '');
}

function runStripLostItemsTokenMigration(db) {
  const columns = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  if (!columns.length) return 0;
  const fields = ['body', 'bodyEn'].filter((f) => columns.includes(f));
  const rows = db.prepare(`SELECT id, ${fields.join(', ')} FROM email_templates`).all();
  let updated = 0;
  for (const row of rows) {
    for (const field of fields) {
      const next = stripLostItemsToken(row[field]);
      if (next === null) continue;
      db.prepare(`UPDATE email_templates SET ${field} = ?, updatedAt = datetime('now') WHERE id = ?`).run(next, row.id);
      updated += 1;
    }
  }
  return updated;
}

/** Returns true when the column was dropped, false when it was already gone. */
function dropLostItemsColumn(db) {
  const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!columns.includes('lostItems')) return false;
  db.exec('ALTER TABLE reservations DROP COLUMN lostItems');
  return true;
}

module.exports = { stripLostItemsToken, runStripLostItemsTokenMigration, dropLostItemsColumn };
