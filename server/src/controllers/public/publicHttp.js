/**
 * Uniform public HTTP envelope (specs/public-api.md §4.3).
 *   success → { data: <payload> }
 *   error   → { error: { code, message, details? } }
 * `message` stays generic/non-fingerprinting; `code` is a stable machine string.
 */

function ok(res, data, status = 200) {
  return res.status(status).json({ data });
}

function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details && details.length) error.details = details;
  return res.status(status).json({ error });
}

module.exports = { ok, fail };
