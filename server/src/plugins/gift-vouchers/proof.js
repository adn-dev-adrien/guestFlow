/**
 * The proof-of-work in front of the public voucher calls (specs/gift-vouchers.md rule 33): the website's own challenge, judged by the SDK's one guard (`sdk.proofGuard`) — the same
 * verdict as the lodging request and the session confirmation: signed for the visitor's address, solved at the difficulty the address owes now, spent once across every form.
 */

const sdk = require('../sdk');

/** → `proof(req) → { ok }`. `pow` and `secret` are injected by a suite. */
function createProof({
  pow, secret, now = () => Date.now(), guard = sdk.proofGuard.createProofGuard({ pow, secret, now }),
}) {
  return function proof(req) {
    const verdict = guard.check({ body: req.body, ip: req.visitor && req.visitor.ip });
    return { ok: verdict.ok };
  };
}

module.exports = { createProof };
