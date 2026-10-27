/**
 * The body-parser errors that are the caller's fault, turned into a French JSON refusal —
 * specs/express-5-upgrade.md rule 7.
 *
 * `express.json()` hands a malformed or oversized body to the global error middleware with
 * `err.type` set; without this the caller read « Erreur interne du serveur » and the log recorded an
 * unhandled crash for what is a bad request. Anything else returns null and stays a real 500.
 */

const REFUSALS = {
  'entity.parse.failed': { status: 400, body: { error: 'Requête invalide : le corps JSON est mal formé.', code: 'INVALID_JSON' } },
  'entity.too.large': { status: 413, body: { error: 'Requête trop volumineuse.', code: 'PAYLOAD_TOO_LARGE' } },
  'encoding.unsupported': { status: 415, body: { error: 'Encodage de la requête non pris en charge.', code: 'UNSUPPORTED_ENCODING' } },
  'charset.unsupported': { status: 415, body: { error: 'Jeu de caractères de la requête non pris en charge.', code: 'UNSUPPORTED_CHARSET' } },
};

function bodyParserRefusal(err) {
  if (!err || typeof err.type !== 'string') return null;
  return REFUSALS[err.type] || null;
}

module.exports = { bodyParserRefusal };
