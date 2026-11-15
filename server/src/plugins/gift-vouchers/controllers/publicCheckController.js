/**
 * `POST /public/v1/gift-vouchers/check` (specs/gift-vouchers.md rules 33-35). A check never changes a voucher. Behind the
 * public key and the visitor context (the router), it asks for a solved proof-of-work, then the limits, then judges the
 * code: mistyped (400, never counted), unknown or cancelled (404, counted), or its state. What is recorded is the visitor
 * hash, the outcome and the time — never the typed code.
 */

const code = require('../code');
const rules = require('../voucherRules');
const { visitorHashOf } = require('../visitorHash');

const MESSAGES = Object.freeze({
  CHALLENGE_INVALID: { fr: 'Vérification impossible, recommencer.', en: 'Verification failed, please try again.' },
  VOUCHER_CODE_MISTYPED: { fr: 'Code mal recopié : vérifier chaque caractère.', en: 'Code mistyped: please check every character.' },
  VOUCHER_UNKNOWN: { fr: 'Code inconnu.', en: 'Unknown code.' },
  VOUCHER_CHECKS_EXCEEDED: { fr: 'Trop d’essais. Nouvelle saisie possible plus tard.', en: 'Too many attempts. Please try again later.' },
  VOUCHER_CHECKS_PAUSED: { fr: 'Vérification indisponible pour le moment.', en: 'Verification is unavailable for now.' },
});

/**
 * `proof(req)` → `{ ok }`: the proof-of-work of the request, solved and spent once. `pepper()` keys the visitor hash.
 */
function buildPublicCheckController({
  vouchers, checks, limits, pepper, proof, ipOf, now = () => new Date(), respond,
}) {
  const visitorHashFor = (req) => visitorHashOf(pepper(), ipOf(req));
  const langOf = (req) => (req.body && req.body.lang === 'en') || (req.query && req.query.lang === 'en') ? 'en' : 'fr';
  const refuse = (req, res, status, errorCode, extra = {}, headers = {}) => {
    Object.entries(headers).forEach(([k, v]) => res.set(k, String(v)));
    return respond.fail(res, status, errorCode, MESSAGES[errorCode][langOf(req)], extra.details);
  };

  async function check(req, res) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (typeof body.code !== 'string' || body.code.length > 64) return refuse(req, res, 400, 'VOUCHER_CODE_MISTYPED');
    if (!proof(req).ok) return refuse(req, res, 403, 'CHALLENGE_INVALID');
    const visitorHash = visitorHashFor(req);
    const limited = limits.refusal(visitorHash);
    if (limited) return refuse(req, res, 429, limited.code, {}, { 'Retry-After': limited.retryAfterSeconds });

    const normalised = code.normalise(body.code);
    if (!code.hasValidCheck(normalised)) {
      checks.record({ visitorHash, outcome: 'mistyped' });
      return refuse(req, res, 400, 'VOUCHER_CODE_MISTYPED');
    }
    const voucher = vouchers.findByCodeHash(code.hashCode(pepper(), normalised));
    if (!voucher || voucher.cancelledAt) {
      checks.record({ visitorHash, outcome: 'unknown' });
      return refuse(req, res, 404, 'VOUCHER_UNKNOWN', { details: [{ triesLeft: limits.triesLeft(visitorHash) }] });
    }
    const state = rules.stateOf({ voucher, balanceCents: voucher.balanceCents, today: rules.parisDate(now()) });
    checks.record({ visitorHash, outcome: rules.isUsable(state) ? 'usable' : state });
    res.set('Cache-Control', 'no-store');
    if (rules.isUsable(state)) return respond.ok(res, { usable: true, balanceCents: voucher.balanceCents, expiresOn: voucher.expiresOn });
    return respond.ok(res, { usable: false, reason: state, ...(state === 'expired' ? { expiresOn: voucher.expiresOn } : {}) });
  }

  return { check };
}

module.exports = { buildPublicCheckController };
