/**
 * One-shot (specs/terms-acceptance-record.md rule 27): the stored `reservation_confirmation` template
 * gains the paragraph linking to the CGV of the stay. It goes just before the « Une question… » /
 * « Any question… » paragraph when the operator kept it, at the end of the body otherwise. A body
 * that already holds `{{cgvUrl}}` is left alone. Returns the number of fields updated.
 */

const { CGV_SENTENCE_FR, CGV_SENTENCE_EN, cgvParagraph } = require('./guestEmailSequenceTemplates');

function insertCgvParagraph(body, sentence, anchor) {
  const text = String(body || '');
  if (text.includes('{{cgvUrl}}')) return null;
  const at = text.indexOf(anchor);
  if (at >= 0) return `${text.slice(0, at)}${cgvParagraph(sentence)}${text.slice(at)}`;
  return `${text.replace(/\s+$/, '')}\n\n{{#if hasCgvUrl}}${sentence}{{/if}}`;
}

function runConfirmationCgvLinkMigration(db) {
  const row = db.prepare("SELECT id, body, bodyEn FROM email_templates WHERE stableKey = 'reservation_confirmation'").get();
  if (!row) return 0;
  let updated = 0;
  const fr = insertCgvParagraph(row.body, CGV_SENTENCE_FR, 'Une question');
  if (fr !== null) {
    db.prepare("UPDATE email_templates SET body = ?, updatedAt = datetime('now') WHERE id = ?").run(fr, row.id);
    updated += 1;
  }
  if (row.bodyEn) {
    const en = insertCgvParagraph(row.bodyEn, CGV_SENTENCE_EN, 'Any question');
    if (en !== null) {
      db.prepare("UPDATE email_templates SET bodyEn = ?, updatedAt = datetime('now') WHERE id = ?").run(en, row.id);
      updated += 1;
    }
  }
  return updated;
}

module.exports = { runConfirmationCgvLinkMigration, insertCgvParagraph };
