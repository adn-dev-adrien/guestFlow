/**
 * Email template language selection (specs/email-language-fr-en.md §3 rules 2-3).
 *
 * A template row holds a French `subject`/`body` and an optional English `subjectEn`/`bodyEn`.
 * Given a requested language, pick the right side — with a graceful FR fallback so an operator
 * template without an English version still sends (in French), never blank.
 *
 * Pure: no DB, no I/O.
 */

function normaliseLang(v) {
  return String(v || '').toLowerCase() === 'en' ? 'en' : 'fr';
}

// Returns `{ subject, body, usedLang }`. English is considered available only when `bodyEn` is
// non-empty (the body is the substantive part); a missing English subject then falls back to the
// French subject. Any other case → the French side.
function pickTemplateSide(template, lang) {
  const t = template || {};
  const wantEn = normaliseLang(lang) === 'en';
  const bodyEn = String(t.bodyEn || '').trim();
  if (wantEn && bodyEn) {
    const subjectEn = String(t.subjectEn || '').trim();
    return {
      subject: subjectEn || String(t.subject || ''),
      body: String(t.bodyEn),
      usedLang: 'en',
    };
  }
  return {
    subject: String(t.subject || ''),
    body: String(t.body || ''),
    usedLang: 'fr',
  };
}

module.exports = { normaliseLang, pickTemplateSide };
