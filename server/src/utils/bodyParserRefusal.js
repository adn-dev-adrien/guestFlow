/**
 * The body-parser errors that are the caller's fault, turned into a French JSON refusal —
 * specs/express-5-upgrade.md rule 7.
 *
 * `express.json()` hands a malformed or oversized body to the global error middleware with
 * `err.type` set; without this the caller read « Erreur interne du serveur » and the log recorded an
 * unhandled crash for what is a bad request. Anything else returns null and stays a real 500.
 * `messageKey` is the sentence the public tree answers with, in its own envelope (specs/public-api.md rule 22).
 *
 * `requestRefusal` adds what the same terminal handler must not read as a crash: a compressed body that does not
 * inflate, a dropped upload, a badly encoded path parameter (specs/express-5-upgrade.md rule 9), and the last-resort
 * net of a wrong JSON type no route refused first (specs/hosting-h2-account-security.md rule 68).
 */

const REFUSALS = {
  'entity.parse.failed': { status: 400, messageKey: 'bodyMalformed', body: { error: 'Requête invalide : le corps JSON est mal formé.', code: 'INVALID_JSON' } },
  'entity.too.large': { status: 413, messageKey: 'bodyTooLarge', body: { error: 'Requête trop volumineuse.', code: 'PAYLOAD_TOO_LARGE' } },
  'encoding.unsupported': { status: 415, messageKey: 'bodyUnsupported', body: { error: 'Encodage de la requête non pris en charge.', code: 'UNSUPPORTED_ENCODING' } },
  'charset.unsupported': { status: 415, messageKey: 'bodyUnsupported', body: { error: 'Jeu de caractères de la requête non pris en charge.', code: 'UNSUPPORTED_CHARSET' } },
};

const UNREADABLE = REFUSALS['entity.parse.failed'];
const UNDECODABLE_PARAM = { status: 404, messageKey: 'notFound', body: { error: 'Introuvable.', code: 'NOT_FOUND' } };
const WRONG_FIELD_TYPE = { status: 400, messageKey: 'bodyMalformed', body: { error: 'Requête invalide.', code: 'INVALID_FIELD_TYPE' } };

function bodyParserRefusal(err) {
  if (!err || typeof err.type !== 'string') return null;
  return REFUSALS[err.type] || null;
}

// `String()`, `Number()` or a template literal on {"toString":1}: the one input no type check upstream caught.
const isWrongFieldType = (err) => err instanceof TypeError && err.message === 'Cannot convert object to primitive value';

function requestRefusal(err) {
  if (!err) return null;
  // body-parser wraps a zlib failure with status 400 and no `type`.
  if (err.status === 400 && typeof err.code === 'string' && /^(Z_|ERR_)/.test(err.code)) return UNREADABLE;
  if (err.type === 'request.aborted' || err.type === 'request.size.invalid') return UNREADABLE;
  if (err instanceof URIError && String(err.message).startsWith('Failed to decode param')) return UNDECODABLE_PARAM;
  if (isWrongFieldType(err)) return WRONG_FIELD_TYPE;
  return null;
}

module.exports = { bodyParserRefusal, requestRefusal, isWrongFieldType, WRONG_FIELD_TYPE };
