const crypto = require('crypto');

/**
 * guestFlow signs its answers to the house (specs/gate-access-sowel-connector.md §3.4 rules 22b-22d).
 *
 * The request signature proves the caller is Sowel; this one proves the answer comes from guestFlow.
 * Without it, a server posing as guestFlow could hand Sowel a list of keys to create, or collect the
 * codes and links Sowel posts back. Every 2xx answer of `/public/v1/gate/*` carries:
 *
 *   X-Gate-Response-Signature = hex HMAC-SHA256(GATE_SIGNING_SECRET,
 *                                 "response\n" + <the request's X-Gate-Signature> + "\n"
 *                                 + sha256hex(<exact response body bytes>))
 *
 * Binding to the request's own signature makes an old answer useless for a new request.
 *
 * It is enforced in ONE place: this middleware replaces `res.send` for the whole gate router, and
 * Express's `res.json` goes through `res.send`. A gate route therefore cannot answer unsigned, and
 * the bytes signed are the bytes sent — the body is serialised once, then written with `res.end`
 * (no ETag, no 304 that would drop the body the signature covers).
 */

function responseSignature(secret, requestSignature, body) {
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  return crypto
    .createHmac('sha256', String(secret))
    .update(`response\n${String(requestSignature)}\n${digest}`)
    .digest('hex');
}

function buildSignGateResponse({ env = process.env } = {}) {
  return function signGateResponse(req, res, next) {
    res.send = function sendSigned(body) {
      if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined || body === null ? '' : String(body), 'utf8');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const secret = String(env.GATE_SIGNING_SECRET || '').trim();
        res.setHeader('X-Gate-Response-Signature', responseSignature(secret, req.get('x-gate-signature') || '', bytes));
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(bytes.length));
      res.end(bytes);
      return res;
    };
    next();
  };
}

module.exports = buildSignGateResponse();
module.exports.buildSignGateResponse = buildSignGateResponse;
module.exports.responseSignature = responseSignature;
