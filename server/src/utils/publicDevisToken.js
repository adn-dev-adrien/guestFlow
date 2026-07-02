/**
 * Per-devis capability token for the public payment flow (specs/public-online-payment.md §7).
 *
 * The public `/pay` and `/status` routes are addressed by the sequential devis row id, which is
 * guessable. To stop enumeration (reading another booking's recap, minting its payment link), each
 * public devis carries an unguessable random token, minted at booking-request creation and required —
 * constant-time compared — on both routes. The token is a low-sensitivity capability (it authorises
 * reading/paying ONE booking, exposes no PII), so travelling in the return URL is acceptable.
 */

const crypto = require('crypto');

// 32 url-safe chars (~192 bits) — safe to embed in a redirect URL / query string.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Constant-time equality that never throws and rejects empty/oversized/mismatched-length inputs.
function tokensMatch(stored, provided) {
  if (typeof stored !== 'string' || typeof provided !== 'string') return false;
  if (stored.length === 0 || provided.length === 0) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { generateToken, tokensMatch };
