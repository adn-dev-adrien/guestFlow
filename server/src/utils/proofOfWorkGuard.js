/**
 * The proof of work in front of a public write, one judgment for every form of the site (SDK 2.35.0; specs/public-request-abuse-and-grouping.md rules 3, 4, 5b, 29, 32): the lodging request,
 * the gift voucher calls and the session confirmation. A proof is signed for the visitor's address, solved (not fetched for nothing), spent once — in one memory shared by all of them —
 * and signed at a difficulty that still covers what the address owes now. Only a request that passes is logged.
 *
 *   createProofGuard({ pow?, secret?, store?, now? }).check({ body, ip }) → { ok: true } | { ok: false, issue }
 *       `issue` ∈ missing · forged · expired · tooFast · wrong · used · tooEasy
 */

const HOUR_MS = 60 * 60 * 1000;

function createProofGuard({
  pow = require('./proofOfWork'), secret = () => require('./localEnv').getOrCreateSecret(pow.SECRET_NAME, 32), store = require('./proofOfWorkStore'), now = () => Date.now(),
} = {}) {
  function check({ body, ip }) {
    const sent = body && typeof body === 'object' ? body : {};
    const at = now();
    const ipKey = pow.ipKeyOf(ip);
    const result = pow.verify({
      secret: secret(), challenge: sent.challenge, nonce: sent.nonce, ipKey, now: at,
    });
    if (!result.ok) return { ok: false, issue: result.reason };
    if (!store.spendChallenge(result.challengeId, result.expiresAt, { now: at })) return { ok: false, issue: 'used' };
    // Judged at the difficulty signed into it, which must still cover what this address owes now (its own sends of the hour in full, the flood surcharge with one step of grace).
    const required = pow.requiredDifficulty({
      addressRequestsLastHour: store.countRecent({ ipKey, windowMs: HOUR_MS, now: at }),
      requestsLastHour: store.countRecent({ windowMs: HOUR_MS, now: at }),
    });
    if (Number(sent.challenge.difficulty) < required) return { ok: false, issue: 'tooEasy' };
    store.logRequest(ipKey, { now: at });
    return { ok: true };
  }
  return { check };
}

// `store` is the one memory of the proofs (spent challenges, the request log), handed to the plugins that keep their own tables around it.
module.exports = { createProofGuard, store: require('./proofOfWorkStore') };
