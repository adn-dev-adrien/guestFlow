/**
 * `POST /public/v1/gift-vouchers/use`, `/use/slots`, `/use/quote`, `/use/confirm` (specs/gift-voucher-campaigns.md rules 23-32, §4.4): « Mon bain », where the recipient of a composed
 * voucher chooses a slot. Behind the public key and the visitor context (the router). The code is always in the body, never in a URL, so no log keeps it; a wrong code counts against the
 * same per-visitor limits as the public check, and the two calls that open or write — the first read of a code and the confirmation — ask for the signed proof of work. Thin: parse,
 * guard, call `useService`, answer. Every rule, price and sentence is the service's.
 */

const MAX_RETURN_PATH = 200;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildPublicUseController({
  useService, proof, respond, siteOrigin,
}) {
  const bodyOf = (req) => (isObject(req.body) ? req.body : {});

  const answer = (res, result) => {
    res.set('Cache-Control', 'no-store');
    if (result.ok) return respond.ok(res, result.data);
    if (result.retryAfterSeconds) res.set('Retry-After', String(result.retryAfterSeconds));
    const details = [
      ...(result.expiresOn ? [{ expiresOn: result.expiresOn }] : []),
      ...(result.triesLeft !== undefined ? [{ triesLeft: result.triesLeft }] : []),
      ...(result.horizonUntil ? [{ horizonUntil: result.horizonUntil }] : []),
    ];
    return respond.fail(res, result.status || 400, result.code, result.message, details.length ? details : undefined);
  };

  const invalid = (res) => respond.fail(res, 400, 'BODY_INVALID', 'Demande invalide.');
  const unproven = (res) => respond.fail(res, 403, 'CHALLENGE_INVALID', 'Vérification impossible, recommencer.');

  /** The page the visitor leaves for the bank, and comes back to: the site's origin and a path only, never an address of the request's own. */
  function returnUrlOf(path) {
    const origin = siteOrigin();
    if (!origin || typeof path !== 'string') return null;
    const clean = path.trim().replace(/#.*$/, '');
    if (!clean.startsWith('/') || clean.startsWith('//') || clean.length > MAX_RETURN_PATH || /[\s\\]/.test(clean)) return null;
    return `${origin}${clean}`;
  }

  const open = (req, res) => {
    const body = bodyOf(req);
    if (typeof body.code !== 'string' || body.code.length > 64) return invalid(res);
    if (!proof(req).ok) return unproven(res);
    return answer(res, useService.open({ code: body.code, visitor: req.visitor || {} }));
  };

  const slots = (req, res) => {
    const body = bodyOf(req);
    if (typeof body.code !== 'string' || body.code.length > 64 || typeof body.from !== 'string' || typeof body.to !== 'string') return invalid(res);
    return answer(res, useService.slots({
      code: body.code, from: body.from, to: body.to, extraMinutes: body.extraMinutes, visitor: req.visitor || {},
    }));
  };

  const quote = (req, res) => {
    const body = bodyOf(req);
    if (typeof body.code !== 'string' || body.code.length > 64 || typeof body.start !== 'string') return invalid(res);
    return answer(res, useService.quote({
      code: body.code, start: body.start, extraMinutes: body.extraMinutes, addOns: body.addOns, visitor: req.visitor || {},
    }));
  };

  const confirm = async (req, res) => {
    const body = bodyOf(req);
    if (typeof body.code !== 'string' || body.code.length > 64 || typeof body.start !== 'string') return invalid(res);
    if (!proof(req).ok) return unproven(res);
    const result = await useService.confirm({
      code: body.code,
      start: body.start,
      extraMinutes: body.extraMinutes,
      addOns: body.addOns,
      email: body.email,
      phone: body.phone,
      name: body.name,
      firstName: body.firstName,
      lastName: body.lastName,
      people: body.people,
      termsVersionId: body.termsVersionId,
      returnUrl: returnUrlOf(body.returnPath),
      visitor: req.visitor || {},
    });
    return answer(res, result);
  };

  return {
    open, slots, quote, confirm,
  };
}

module.exports = { buildPublicUseController };
