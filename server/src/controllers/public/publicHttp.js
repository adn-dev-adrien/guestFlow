/**
 * Uniform public HTTP envelope (specs/public-api.md §4.3).
 *   success → { data: <payload> }
 *   error   → { error: { code, message, details? } }
 * `message` stays generic/non-fingerprinting; `code` is a stable machine string.
 *
 * Language (specs/site-english-version.md §3 rules 1 and 8): `code` never moves — it is what a
 * consumer branches on — only `message` follows the caller's language.
 */

const { errorMessage, normalisePublicLang, statesLang } = require('../../utils/publicLabels');

function ok(res, data, status = 200) {
  return res.status(status).json({ data });
}

function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details && details.length) error.details = details;
  return res.status(status).json({ error });
}

/**
 * The language a public request is asking for: `?lang=` first, then the JSON body (POST /quote and
 * POST /booking-requests carry it there), then French.
 *
 * Never throws and never rejects: rule 1 is explicit that a visitor must not lose a booking funnel
 * over a language token, so an unknown or malformed value simply reads as French.
 */
function langOf(req) {
  const raw = req?.query?.lang ?? req?.body?.lang;
  return normalisePublicLang(raw);
}

/**
 * Whether the request stated a language at all — as opposed to being read as French by default.
 *
 * Rule 12 turns on this distinction: an explicit language may overwrite the one stored on a guest,
 * silence may not. `langOf` alone cannot answer it, since it returns `fr` for both.
 */
function langStated(req) {
  const raw = req?.query?.lang ?? req?.body?.lang;
  return statesLang(raw);
}

/**
 * `fail`, with the message looked up by meaning in the caller's language.
 *
 * Keyed by meaning rather than by `code` because `VALIDATION_FAILED` covers six distinct refusals:
 * an invalid date range and an option that does not belong to the property share a code but must
 * not share a sentence.
 */
function failT(res, req, status, code, messageKey, details, ...args) {
  return fail(res, status, code, errorMessage(langOf(req), messageKey, ...args), details);
}

module.exports = { ok, fail, failT, langOf, langStated };
