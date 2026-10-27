/**
 * Email template language selection (specs/email-language-fr-en.md §3 rules 2-3 and 9).
 *
 * A template row holds a French `subject`/`body` and an optional English `subjectEn`/`bodyEn`.
 * Given a requested language, pick the right side. A template without an English version is never
 * SENT to an English-speaking guest (rule 9, operator decision of 2026-10-27): `englishMissing`
 * says so, and every send path refuses or skips it with ENGLISH_VERSION_MISSING. The French side is
 * still what a preview shows, so the operator sees which template it is.
 *
 * Pure: no DB, no I/O.
 */

const ENGLISH_VERSION_MISSING = 'ENGLISH_VERSION_MISSING';
const ENGLISH_VERSION_MISSING_MESSAGE = 'Version anglaise manquante pour ce modèle.';

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

const hasEnglishVersion = (template) => Boolean(String((template && template.bodyEn) || '').trim());

// Rule 9 — true when the guest reads English and the template has no English body.
function englishMissing(template, lang) {
  return normaliseLang(lang) === 'en' && !hasEnglishVersion(template);
}

module.exports = {
  normaliseLang, pickTemplateSide, hasEnglishVersion, englishMissing,
  ENGLISH_VERSION_MISSING, ENGLISH_VERSION_MISSING_MESSAGE,
};
