/**
 * One-shot (specs/guest-email-texts-made-simple.md rule 36): a stored template that prints
 * `{{cgvUrl}}` outside `{{#if hasCgvUrl}}` — an operator who rewrote the CGV sentence by hand — gets
 * that paragraph wrapped in the condition. While the link exists the email reads exactly as before;
 * while it does not, the sentence is left out instead of ending on « ici : » and nothing.
 *
 * A line already inside another condition is left alone: the renderer has one level only.
 * Returns the number of fields updated.
 */

const { structureError } = require('./emailTemplateRenderer');
const { namesUsedOutside } = require('./templateTokens');

function wrapCgvParagraph(body) {
  const text = String(body || '');
  if (!namesUsedOutside(text, 'hasCgvUrl').has('cgvUrl')) return null;
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.includes('{{cgvUrl}}'));
  if (at < 0) return null;
  const blankAfter = at + 1 < lines.length && lines[at + 1].trim() === '';
  let wrapped;
  if (blankAfter) {
    const before = lines.slice(0, at).join('\n');
    const after = lines.slice(at + 2).join('\n');
    wrapped = `${before}${at > 0 ? '\n' : ''}{{#if hasCgvUrl}}${lines[at]}\n\n{{/if}}${after}`;
  } else {
    const before = lines.slice(0, at).join('\n');
    const after = lines.slice(at + 1).join('\n');
    wrapped = `${before}${at > 0 ? '\n' : ''}{{#if hasCgvUrl}}${lines[at]}{{/if}}${at + 1 < lines.length ? '\n' : ''}${after}`;
  }
  if (structureError(wrapped) || namesUsedOutside(wrapped, 'hasCgvUrl').has('cgvUrl')) return null;
  return wrapped;
}

function runCgvLinkConditionMigration(db) {
  let updated = 0;
  const fields = ['body', 'bodyEn'].filter((f) => db.prepare('PRAGMA table_info(email_templates)').all().some((c) => c.name === f));
  for (const row of db.prepare(`SELECT id, ${fields.join(', ')} FROM email_templates`).all()) {
    for (const field of fields) {
      const next = wrapCgvParagraph(row[field]);
      if (next === null) continue;
      db.prepare(`UPDATE email_templates SET ${field} = ?, updatedAt = datetime('now') WHERE id = ?`).run(next, row.id);
      updated += 1;
    }
  }
  return updated;
}

module.exports = { runCgvLinkConditionMigration, wrapCgvParagraph };
