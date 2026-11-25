/**
 * `/public/v1/sessions/*` (specs/site-outside-resource-booking.md §4.4): the website's booking of a session outside a stay. Behind the public key and the visitor context (the router).
 * The confirmation asks for the signed proof of work and has the booking-request limiter's budget. Thin: parse, guard, call `publicSessionService`, answer. Every rule, price and
 * sentence is the service's.
 */

const MAX_RETURN_PATH = 200;
const UNPROCESSABLE = 422;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildPublicSessionController({
  service, proof, respond, siteOrigin,
}) {
  const bodyOf = (req) => (isObject(req.body) ? req.body : {});

  // A refusal of a write is a 422, the lodging tunnel's answer: the limiter of the booking requests gives its hit back (an answer a visitor corrects costs him nothing).
  const answer = (res, result, { refused = null } = {}) => {
    res.set('Cache-Control', 'no-store');
    if (result.ok) return respond.ok(res, result.data);
    const details = [
      ...(result.field ? [{ field: result.field }] : []),
      ...(result.horizonUntil ? [{ horizonUntil: result.horizonUntil }] : []),
    ];
    const status = result.status || 400;
    return respond.fail(res, refused && status < 500 ? refused : status, result.code, result.message, details.length ? details : undefined);
  };

  const invalid = (res) => respond.fail(res, 400, 'BODY_INVALID', 'Demande invalide.');

  /** The page the visitor leaves for the bank, and comes back to: the site's origin and a path only, never an address of the request's own. */
  function returnUrlOf(path) {
    const origin = siteOrigin();
    if (!origin || typeof path !== 'string') return null;
    const clean = path.trim().replace(/#.*$/, '');
    if (!clean.startsWith('/') || clean.startsWith('//') || clean.length > MAX_RETURN_PATH || /[\s\\]/.test(clean)) return null;
    return `${origin}${clean}`;
  }

  const resources = (req, res) => answer(res, { ok: true, data: service.resources() });

  const slots = (req, res) => {
    const body = bodyOf(req);
    if (typeof body.from !== 'string' || typeof body.to !== 'string') return invalid(res);
    return answer(res, service.slots({
      resourceId: body.resourceId, from: body.from, to: body.to, minutes: body.minutes,
    }));
  };

  const quote = (req, res) => {
    const body = bodyOf(req);
    if (typeof body.start !== 'string') return invalid(res);
    return answer(res, service.quote({
      resourceId: body.resourceId, start: body.start, minutes: body.minutes, addOns: body.addOns,
    }));
  };

  const confirm = async (req, res) => {
    const body = bodyOf(req);
    if (typeof body.start !== 'string') return invalid(res);
    if (!proof(req).ok) return respond.fail(res, UNPROCESSABLE, 'PROOF_INVALID', 'Vérification impossible, recommencer.');
    const result = await service.confirm({
      resourceId: body.resourceId,
      start: body.start,
      minutes: body.minutes,
      addOns: body.addOns,
      people: body.people,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      termsVersionId: body.termsVersionId,
      returnUrl: returnUrlOf(body.returnPath),
      visitor: req.visitor || {},
    });
    return answer(res, result, { refused: UNPROCESSABLE });
  };

  const status = async (req, res) => answer(res, await service.status(String(req.params.ref)));

  return {
    resources, slots, quote, confirm, status,
  };
}

module.exports = { buildPublicSessionController };
