/**
 * The mini SAS of an outside visit — HTTP handlers (specs/outside-booking-sas.md §4.3, rules 1-34, 39-42).
 *
 *   GET    /:id/visit                              the visit payload
 *   GET    /:id/visit/articles?q=                  « Autre article »: the articles sellable with no stay, filtered by `q`
 *   POST   /:id/visit/quote                        the payload of a draft, nothing written
 *   POST   /:id/visit                              « Valider l'arrivée » / « Enregistrer », then the invoice when asked (its failure never undoes the commit)
 *   POST   /:id/visit/payment                      a payment on the reste
 *   PATCH  /:id/visit/lines/:lineId                « Offrir » / « Retirer » a stored line
 *   POST   /:id/no-show                            « Client absent » (admin)
 *   POST   /:id/visit/payment-link                 « Envoyer un lien » for the reste
 *   DELETE /:id/visit/payment-link/:linkId         « Retirer le lien »
 *   POST   /:id/visit/payment-link/:linkId/email   « Envoyer par e-mail », on the click only
 *
 * Roles (rule 7): an administrator opens, commits and reopens at any time once the visit is opened; a reception user works inside the day window of
 * rule 5 only and never touches a paid line or a refund (403 `ADMIN_ONLY`). The window itself is the visit model's (the core's SAS clock).
 */

const sdk = require('../sdk');

const { isReceptionOnly } = sdk.coreModule('roles');

const NOT_TODAY = 'Arrivée : le jour de la séance seulement.';
const ADMIN_ONLY = 'Remboursement : réservé à l’administrateur.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LINK_REFUSALS = Object.freeze({
  PROVIDER_NOT_READY: 'Aucun moyen de paiement en ligne n’est connecté.',
  NOTHING_DUE: 'Rien à encaisser.',
  NO_EMAIL: 'Adresse e-mail requise.',
});

function createVisitController({ bookings, visits, invoicing }) {
  const fail = (res, result) => res.status(result.status).json({
    error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.refusals ? { refusals: result.refusals } : {}), ...(result.field ? { field: result.field } : {}),
  });
  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const actorOf = (req) => (req.user && (req.user.email || req.user.username || req.user.id)) || null;

  // The booking of the visit, or the refusal that applies to every visit route (rules 1, 24, 27).
  function bookingOf(req) {
    const row = bookings().rawById(req.params.id);
    if (!row) return { refusal: { status: 404, code: 'BOOKING_NOT_FOUND', error: 'Réservation non trouvée' } };
    if (row.reservationId) return { refusal: { status: 409, code: 'BOOKING_HAS_STAY', error: 'Cette séance appartient à un séjour : son sas d’arrivée est celui du séjour.' } };
    return { row };
  }

  // Rules 5, 7, 24, 27 — may this user write on the visit now?
  function writeRefusal(row, req) {
    const reception = isReceptionOnly(req.user);
    const window = visits().windowOf(row);
    if (row.noShowAt) return { status: 409, code: 'BOOKING_NO_SHOW', error: 'Client absent : la visite est close.' };
    if (row.qontoInvoiceId && !row.invoiceCancelledAt) return { status: 409, code: 'BOOKING_INVOICED', error: 'Facturée : nouvelle vente séparée.' };
    if (reception && !window.open) return { status: 409, code: 'ARRIVAL_NOT_TODAY', error: NOT_TODAY };
    if (!window.open && !row.arrivedAt) return { status: 409, code: 'ARRIVAL_NOT_TODAY', error: NOT_TODAY };
    return null;
  }

  // What this caller may do on the visit now, so the screen shows it read-only instead of guessing the rules of rules 5, 7, 24, 27: `{ writable, reason, reception }`.
  const accessOf = (row, req) => {
    const refused = writeRefusal(row, req);
    return { writable: !refused, reason: refused ? refused.error : null, reception: isReceptionOnly(req.user) };
  };

  const sendView = (res, row, req, extra = {}) => {
    const current = bookings().rawById(row.id);
    const out = visits().view(current, { reception: isReceptionOnly(req.user) });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    return res.json({ visit: { ...out.body, access: accessOf(current, req) }, ...extra });
  };

  function getVisit(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const out = visits().view(row, { reception: isReceptionOnly(req.user) });
    return res.status(out.status).json(out.status === 200 ? { ...out.body, access: accessOf(row, req) } : out.body);
  }

  // The quote body's shape, judged before the model (§4.3): extras a list of objects, flags booleans.
  function draftRefusal(body) {
    if (body.extras !== undefined && (!Array.isArray(body.extras) || body.extras.some((extra) => !isPlainObject(extra)))) return 'Articles invalides.';
    if (body.sessionOffered !== undefined && typeof body.sessionOffered !== 'boolean') return 'Offrir : oui ou non.';
    if (body.customer !== undefined && body.customer !== null && !isPlainObject(body.customer)) return 'Client invalide.';
    return null;
  }

  // Rule 11 — « Autre article »: the articles sellable with no stay, grouped by category, filtered by what is typed. Door information only (label, unit price).
  function articles(req, res) {
    const { refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    return res.json({ articles: sdk.coreModule('suggestedArticles').catalogue({ customerContext: 'external', q }) });
  }

  function quote(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    const shape = draftRefusal(body);
    if (shape) return res.status(400).json({ error: shape, code: 'INVALID_PAYLOAD' });
    const out = visits().view(row, { reception: isReceptionOnly(req.user), draft: body });
    return res.status(out.status).json(out.status === 200 ? { ...out.body, access: accessOf(row, req) } : out.body);
  }

  async function commit(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    const shape = draftRefusal(body);
    if (shape) return res.status(400).json({ error: shape, code: 'INVALID_PAYLOAD' });
    if (body.payment !== undefined && body.payment !== null && !isPlainObject(body.payment)) return res.status(400).json({ error: 'Paiement invalide.', code: 'INVALID_PAYLOAD' });
    // Invoicing rule 45 — the invoice is the operator's explicit choice: anything but a boolean is refused before the arrival.
    if (body.invoice !== undefined && typeof body.invoice !== 'boolean') return res.status(400).json({ error: 'Facture : oui ou non.', code: 'INVALID_PAYLOAD' });
    const closed = writeRefusal(row, req);
    if (closed) return fail(res, closed);
    if (body.billing !== undefined) {
      const stored = bookings().recordArrivalBilling(row.id, body.billing);
      if (stored && stored.error) return fail(res, stored);
    }
    const result = visits().commit(row, body, { actor: actorOf(req) });
    if (result.error) return fail(res, result);
    let invoice = null;
    if (body.invoice === true) {
      const issued = await invoicing().issue(row.id);
      invoice = issued.error ? { ok: false, code: issued.code || null, error: issued.error } : { ok: true, number: issued.invoice.number };
    }
    return sendView(res, row, req, { invoice });
  }

  function pay(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    const closed = writeRefusal(row, req);
    if (closed) return fail(res, closed);
    const result = visits().pay(row, body, { actor: actorOf(req) });
    if (result.error) return fail(res, result);
    return sendView(res, row, req);
  }

  function patchLine(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    if (body.offered !== undefined && typeof body.offered !== 'boolean') return res.status(400).json({ error: 'Offrir : oui ou non.', code: 'INVALID_PAYLOAD' });
    if (body.remove !== undefined && body.remove !== true) return res.status(400).json({ error: 'Retirer : oui seulement.', code: 'INVALID_PAYLOAD' });
    if (body.offered === undefined && body.remove === undefined) return res.status(400).json({ error: 'Offrir ou retirer.', code: 'INVALID_PAYLOAD' });
    const closed = writeRefusal(row, req);
    if (closed) return fail(res, closed);
    // Rule 7 — a paid line and anything that owes a refund is the administrator's.
    if (isReceptionOnly(req.user) && (body.confirmRefund === true || visits().linePaid(row, req.params.lineId))) {
      return res.status(403).json({ error: ADMIN_ONLY, code: 'ADMIN_ONLY' });
    }
    const result = visits().patchLine(row, req.params.lineId, body);
    if (result.error) return fail(res, result);
    return sendView(res, row, req);
  }

  async function noShow(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    if (isReceptionOnly(req.user)) return res.status(403).json({ error: 'Client absent : réservé à l’administrateur.', code: 'ADMIN_ONLY' });
    const result = await visits().noShow(row);
    if (result.error) return fail(res, result);
    return res.json({ booking: bookings().findById(row.id) });
  }

  // Rules 39-40 — the link is minted on the document of the visit (born here when it has none); its amount is SETTLEMENT's reste, never the request's.
  async function mintLink(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') return res.status(400).json({ error: 'Adresse e-mail invalide.', code: 'EMAIL_INVALID' });
    const closed = writeRefusal(row, req);
    if (closed) return fail(res, closed);
    const typed = typeof body.email === 'string' ? body.email.trim() : '';
    if (typed && !EMAIL.test(typed)) return res.status(400).json({ error: 'Adresse e-mail invalide.', code: 'EMAIL_INVALID' });
    // Refused before anything is written: the reasons the link block already shows (rule 39).
    const block = visits().view(row, { reception: isReceptionOnly(req.user) }).body.paymentLink;
    const reason = block.reason === 'NO_EMAIL' && typed ? null : block.reason;
    if (reason) return res.status(409).json({ error: LINK_REFUSALS[reason], code: reason });
    const saleId = visits().inTransaction((stop) => visits().ensureDocument(row, { actor: actorOf(req), stop, draft: { customer: { email: body.email || undefined } } }));
    if (saleId && saleId.error) return fail(res, saleId);
    if (!saleId) return res.status(409).json({ error: 'Rien à encaisser.', code: 'NOTHING_DUE' });
    const minted = await sdk.coreModule('standaloneSaleLinks').mint(saleId, { email: body.email || null });
    if (minted.status !== 200) return res.status(minted.status).json(minted.body);
    return sendView(res, row, req, { link: minted.link });
  }

  async function withdrawLink(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const saleId = visits().saleIdOf(row);
    if (!saleId) return res.status(404).json({ error: 'Lien introuvable.', code: 'LINK_NOT_FOUND' });
    const out = await sdk.coreModule('standaloneSaleLinks').withdraw(saleId, Number(req.params.linkId));
    if (out.status !== 200) return res.status(out.status).json(out.body);
    return sendView(res, row, req);
  }

  // Rule 42 — the one e-mail of the visit, on this click only.
  async function emailLink(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const saleId = visits().saleIdOf(row);
    if (!saleId) return res.status(404).json({ error: 'Lien introuvable.', code: 'LINK_NOT_FOUND' });
    const out = await sdk.coreModule('standaloneSaleLinks').emailLink(saleId, Number(req.params.linkId));
    if (out.status !== 200) return res.status(out.status).json(out.body);
    return res.json({ sent: out.sent, recipientEmail: out.recipientEmail });
  }

  return {
    getVisit, articles, quote, commit, pay, patchLine, noShow, mintLink, withdrawLink, emailLink,
  };
}

module.exports = { createVisitController };
