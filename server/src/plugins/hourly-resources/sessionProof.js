/**
 * The proof-of-work in front of the website's session confirmation (specs/site-outside-resource-booking.md rule 8): the website's own challenge (`sdk.proofOfWork`, served by
 * `GET /public/v1/booking-requests/challenge`, signed with the shared secret and bound to the visitor's address), verified here and spent once. A challenge solved below the
 * base difficulty — one fetched for no work at all — is refused.
 */

/** → `proof(req) → { ok }`. `spent` remembers a solved challenge until it would have expired anyway. */
function createSessionProof({ pow, secret, now = () => Date.now() }) {
  const spent = new Map();

  function forget(at) {
    spent.forEach((expiresAt, id) => { if (expiresAt < at) spent.delete(id); });
  }

  return function proof(req) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const at = now();
    const ipKey = pow.ipKeyOf(req.visitor && req.visitor.ip);
    const result = pow.verify({
      secret: secret(), challenge: body.challenge, nonce: body.nonce, ipKey, now: at,
    });
    if (!result.ok || Number(body.challenge.difficulty) < pow.BASE_BITS) return { ok: false };
    forget(at);
    if (spent.has(result.challengeId)) return { ok: false };
    spent.set(result.challengeId, Date.parse(result.expiresAt));
    return { ok: true };
  };
}

module.exports = { createSessionProof };
