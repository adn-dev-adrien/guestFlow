/** Rule 19 — the language a guest request is answered in (specs/guest-app.md): asked, else the guest's, else the browser's. */

const SUPPORTED = new Set(['fr', 'en']);

/** `?lang=` first, then the stay's client language, then the browser's; French by default. */
function languageOf(req, stay) {
  const asked = String((req && req.query && req.query.lang) || '').toLowerCase();
  if (SUPPORTED.has(asked)) return asked;
  const onFile = stay && String(stay.clientLanguage || '').toLowerCase();
  if (SUPPORTED.has(onFile)) return onFile;
  return /^en\b/i.test(String((req && req.headers && req.headers['accept-language']) || '')) ? 'en' : 'fr';
}

module.exports = { languageOf };
