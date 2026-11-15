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
    ...(result.refundCents ? { refundCents: result.refundCents } : {}),
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
  // `adminAnyDay`: a gesture that only reduces what the visit exposes (withdrawing its link) is the administrator's on any day (end-review V-8).
  function writeRefusal(row, req, { adminAnyDay = false } = {}) {
    const reception = isReceptionOnly(req.user);
    const window = visits().windowOf(row);
    if (row.noShowAt) return { status: 409, code: 'BOOKING_NO_SHOW', error: 'Client absent : la visite est close.' };
    if (row.qontoInvoiceId && !row.invoiceCancelledAt) return { status: 409, code: 'BOOKING_INVOICED', error: 'Facturée : nouvelle vente séparée.' };
    if (reception && !window.open) return { status: 409, code: 'ARRIVAL_NOT_TODAY', error: NOT_TODAY };
    if (!reception && adminAnyDay) return null;
    if (!window.open && !row.arrivedAt) return { status: 409, code: 'ARRIVAL_NOT_TODAY', error: NOT_TODAY };
    return null;
  }

  // What this caller may do on the visit now, so the screen shows it read-only instead of guessing the rules of rules 5, 7, 24, 27: `{ writable, reason, reception }`.
  // `withdrawLink` (loop t1 AV-7): the administrator withdraws an open link on any day, the reception inside the day window (V-8).
  const accessOf = (row, req) => {
    const refused = writeRefusal(row, req);
    return {
      writable: !refused, reason: refused ? refused.error : null, reception: isReceptionOnly(req.user), withdrawLink: !writeRefusal(row, req, { adminAnyDay: true }),
    };
  };

  // Loop t1 AV-5, AV-6 (reception-role-checkin-only rule 12bis) — the reception sees whether an address is known, never the address, and never the name a
  // typed address matched.
  const forCaller = (body, req) => {
    // Rule 24 (reading of 2026-11-15, loop t1 AV-8) — an invoiced visit offers « Nouvelle vente » on the same client: `newSale.client` seeds the counter's dialog.
    const invoiced = Boolean(body.invoice && !body.invoice.cancelled);
    if (!isReceptionOnly(req.user)) {
      return {
        ...body, invoiceable: invoicing ? invoicing().invoiceability(body.booking.id) : null, newSale: invoiced && body.document ? { client: body.document.client } : null,
      };
    }
    const link = body.paymentLink ? { ...body.paymentLink, hasEmail: Boolean(body.paymentLink.email), email: null } : body.paymentLink;
    const client = body.document && body.document.client;
    const hidden = client && client.kind === 'match' ? { kind: 'match' } : client;
    return { ...body, paymentLink: link, document: body.document ? { ...body.document, client: hidden } : body.document, invoiceable: null, newSale: null };
  };

  const sendView = (res, row, req, extra = {}) => {
    const current = bookings().rawById(row.id);
    const out = visits().view(current, { reception: isReceptionOnly(req.user) });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    return res.json({ visit: { ...forCaller(out.body, req), access: accessOf(current, req) }, ...extra });
  };

  function getVisit(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const out = visits().view(row, { reception: isReceptionOnly(req.user) });
    return res.status(out.status).json(out.status === 200 ? { ...forCaller(out.body, req), access: accessOf(row, req) } : out.body);
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
    const suggested = sdk.coreModule('suggestedArticles');
    // `groups`: the answer as the « Autre article » list shows it, grouped by the server (end review R3-7).
    return res.json({ articles: suggested.catalogue({ customerContext: 'external', q }), groups: suggested.catalogueGroups({ customerContext: 'external', q }) });
  }

  function quote(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const body = isPlainObject(req.body) ? req.body : {};
    const shape = draftRefusal(body);
    if (shape) return res.status(400).json({ error: shape, code: 'INVALID_PAYLOAD' });
    const out = visits().view(row, { reception: isReceptionOnly(req.user), draft: body });
    return res.status(out.status).json(out.status === 200 ? { ...forCaller(out.body, req), access: accessOf(row, req) } : out.body);
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
    // Loop t1 AV-3 (reception rule 17) — the invoice and its billing address are the administrator's.
    if (isReceptionOnly(req.user) && (body.invoice === true || body.billing !== undefined)) return res.status(403).json({ error: 'Facture : réservée à l’administrateur.', code: 'ADMIN_ONLY' });
    // Loop t1 AV-4 (rule 21) — the billing address is written with the commit, in its transaction: a refused commit (a stale version) writes neither.
    const result = visits().inTransaction((stop) => {
      if (body.billing !== undefined) {
        const stored = bookings().recordArrivalBilling(row.id, body.billing);
        if (stored && stored.error) stop(stored);
      }
      const committed = visits().commit(row, body, { actor: actorOf(req) });
      if (committed && committed.error) stop(committed);
      return committed;
    });
    if (result && result.error) return fail(res, result);
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
    // Refused before anything is written: the reasons the link block already shows (rule 39). A view that cannot be read is answered as such,
    // never as a 500 (end review R3-16).
    const viewed = visits().view(row, { reception: isReceptionOnly(req.user) });
    if (viewed.status !== 200) return res.status(viewed.status).json(viewed.body);
    const block = viewed.body.paymentLink || { reason: 'NOTHING_DUE' };
    const reason = block.reason === 'NO_EMAIL' && typed ? null : block.reason;
    if (reason) return res.status(409).json({ error: LINK_REFUSALS[reason], code: reason });
    const saleId = visits().inTransaction((stop) => visits().ensureDocument(row, { actor: actorOf(req), stop, draft: { customer: { email: body.email || undefined } } }));
    if (saleId && saleId.error) return fail(res, saleId);
    if (!saleId) return res.status(409).json({ error: 'Rien à encaisser.', code: 'NOTHING_DUE' });
    const minted = await sdk.coreModule('standaloneSaleLinks').mint(saleId, { email: body.email || null });
    if (minted.status !== 200) return res.status(minted.status).json(minted.body);
    return sendView(res, row, req, { link: minted.link });
  }

  // Rules 7, 39 (end review R3-1) — withdrawing or e-mailing a link is a write of the visit: the reception inside the day window only, nobody on
  // a no-show or an invoiced visit. Withdrawing only reduces exposure: the administrator may do it on any day, a link minted on the day (it lives
  // 36 h) included (V-8).
  async function withdrawLink(req, res) {
    const { row, refusal } = bookingOf(req);
    if (refusal) return fail(res, refusal);
    const closed = writeRefusal(row, req, { adminAnyDay: true });
    if (closed) return fail(res, closed);
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
    const closed = writeRefusal(row, req);
    if (closed) return fail(res, closed);
    const saleId = visits().saleIdOf(row);
    if (!saleId) return res.status(404).json({ error: 'Lien introuvable.', code: 'LINK_NOT_FOUND' });
    const out = await sdk.coreModule('standaloneSaleLinks').emailLink(saleId, Number(req.params.linkId));
    if (out.status !== 200) return res.status(out.status).json(out.body);
    // Loop t1 AV-5 — the reception is told the e-mail left, never to which address.
    return res.json({ sent: out.sent, recipientEmail: isReceptionOnly(req.user) ? null : out.recipientEmail });
  }

  return {
    getVisit, articles, quote, commit, pay, patchLine, noShow, mintLink, withdrawLink, emailLink,
  };
}

module.exports = { createVisitController };
