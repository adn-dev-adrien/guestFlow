/**
 * The public side of the online sale (specs/gift-vouchers.md rules 14-21, specs/gift-voucher-campaigns.md rules 16-19, 52, §4.3): the offer, its price, the order, its payment
 * and the voucher page. `available` is true only while a payment can be taken online (rule 2). It adds what only the site needs — the key guard of the router, the proof of work,
 * the per-visitor limits, the terms version — and leaves every rule of the sale to `offerService`, the path the back-office takes too. The voucher is issued by the core's
 * paid-link path (`orderPaid.js`), never by anything this controller reads from the browser. An order is reached by its id and its token only — a wrong token and an unknown
 * id answer the same 404.
 */

const rules = require('../voucherRules');
const { visitorHashOf } = require('../visitorHash');
const { statusOf } = require('../offerService');

const MAX_RETURN_PATH = 200;
const ORDERS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const DEAD_LINK = new Set(['expired', 'cancelled']);
const REQUEST_KEYS = Object.freeze(['slug', 'amountCents', 'extraMinutes', 'addOns']);

const STATUS = Object.freeze({
  CHALLENGE_INVALID: 403,
  VOUCHER_ORDER_NOT_FOUND: 404,
  TOO_MANY_ORDERS: 429,
  VOUCHER_ALREADY_ISSUED: 409,
  PAYMENT_LINK_EXPIRED: 409,
});

const MESSAGES = Object.freeze({
  BODY_INVALID: { fr: 'Demande invalide.', en: 'Invalid request.' },
  FIELD_INVALID: { fr: 'Un champ est invalide.', en: 'A field is invalid.' },
  CHALLENGE_INVALID: { fr: 'Vérification impossible, recommencer.', en: 'Verification failed, please try again.' },
  AMOUNT_INVALID: { fr: 'Montant invalide.', en: 'Invalid amount.' },
  VOUCHER_AMOUNT_OUT_OF_BOUNDS: { fr: 'Montant hors des bornes.', en: 'The amount is out of bounds.' },
  EMAIL_INVALID: { fr: 'Adresse e-mail invalide.', en: 'Invalid e-mail address.' },
  TERMS_REQUIRED: { fr: 'Les conditions doivent être acceptées.', en: 'The terms must be accepted.' },
  TOO_MANY_ORDERS: { fr: 'Trop de demandes. Nouvel essai possible plus tard.', en: 'Too many requests. Please try again later.' },
  ONLINE_SALE_UNAVAILABLE: { fr: 'La vente en ligne n’est pas disponible pour le moment.', en: 'Online sales are unavailable for now.' },
  VOUCHER_ORDER_NOT_FOUND: { fr: 'Bon introuvable.', en: 'Voucher not found.' },
  VOUCHER_ALREADY_ISSUED: { fr: 'Ce bon est déjà payé.', en: 'This voucher is already paid.' },
  PAYMENT_PENDING: { fr: 'Un paiement est en cours de confirmation.', en: 'A payment is being confirmed.' },
  PAYMENT_LINK_EXPIRED: { fr: 'Le lien de paiement a expiré. Aucun paiement n’a été pris.', en: 'The payment link has expired. No payment was taken.' },
  PAYMENT_PROVIDER_ERROR: { fr: 'Le paiement n’a pas pu être préparé, réessayer.', en: 'The payment could not be prepared, please try again.' },
});

class Refusal extends Error {
  constructor(refusalCode, message = null) {
    super(refusalCode);
    this.code = refusalCode;
    this.detail = message;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildPublicOrdersController({
  offerService, termsVersionId, available, brand, respond, orders, vouchers, proof, pepper, ipOf, payments, siteOrigin,
  decrypt, renderPdf, bookingUrl, now = () => new Date(),
}) {
  const langOf = (req) => {
    const stated = (req.body && req.body.language) || (req.query && req.query.lang);
    return stated === 'en' ? 'en' : 'fr';
  };
  // A refusal of this controller has its sentence in both languages; one of the sale service (an offer closed, a price the engine refuses) carries its own, in French.
  const refuse = (req, res, refusalCode, headers = {}, detail = null) => {
    Object.entries(headers).forEach(([k, v]) => res.set(k, String(v)));
    const words = MESSAGES[refusalCode];
    return respond.fail(res, STATUS[refusalCode] || statusOf(refusalCode), refusalCode, words ? words[langOf(req)] : detail);
  };
  const guarded = (handler) => async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return refuse(req, res, error.code, {}, error.detail);
    }
  };
  const requestOf = (body) => Object.fromEntries(REQUEST_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const orderOf = (req, token) => {
    const id = idOf(req);
    const order = id ? orders.findByToken(id, token) : null;
    if (!order) throw new Refusal('VOUCHER_ORDER_NOT_FOUND');
    return order;
  };
  const readCode = (voucher) => {
    const read = decrypt(voucher.codeEncrypted);
    return read.ok ? read.value : null;
  };

  async function read(req, res) {
    return respond.ok(res, {
      available: available(),
      brand: brand(),
      ...await offerService.offer(),
      termsVersionId: termsVersionId(),
    });
  }

  /** Rule 17 — the price of what the giver composed: the engine's lines, the total incl. VAT and the VAT per rate. The page renders it and computes nothing. */
  const price = guarded((req, res) => {
    if (!isObject(req.body)) throw new Refusal('BODY_INVALID');
    const answered = offerService.price(requestOf(req.body));
    if (!answered.ok) throw new Refusal(answered.code, answered.message);
    return respond.ok(res, { lines: answered.lines, totalCents: answered.totalCents, vat: answered.vat });
  });

  const create = guarded((req, res) => {
    if (!isObject(req.body)) throw new Refusal('BODY_INVALID');
    const body = req.body;
    if (!proof(req).ok) throw new Refusal('CHALLENGE_INVALID');
    const visitorHash = visitorHashOf(pepper(), ipOf(req));
    if (orders.countSince(visitorHash, HOUR_MS) >= ORDERS_PER_HOUR) return refuse(req, res, 'TOO_MANY_ORDERS', { 'Retry-After': HOUR_MS / 1000 });
    const parties = offerService.partiesOf(body, { emailRequired: true });
    if (!parties.ok) throw new Refusal(parties.code);
    const current = termsVersionId();
    if (Number(body.termsVersionId || 0) !== Number(current || 0)) throw new Refusal('TERMS_REQUIRED');
    const created = offerService.createOrder({
      request: requestOf(body),
      parties: parties.value,
      source: 'site',
      visitorHash,
      termsVersionId: current || null,
      termsAcceptedAt: now().toISOString(),
    });
    if (!created.ok) throw new Refusal(created.code, created.message);
    const { order } = created;
    return respond.ok(res, { orderId: order.id, token: order.token }, 201);
  });

  /** The page the visitor left, back with the order's id and token: same site, a path only (never an address of the request's own). */
  function returnUrlOf(order, token, returnPath) {
    const origin = siteOrigin();
    if (!origin || typeof returnPath !== 'string') return null;
    const path = returnPath.trim().replace(/#.*$/, '');
    if (!path.startsWith('/') || path.startsWith('//') || path.length > MAX_RETURN_PATH || /[\s\\]/.test(path)) return null;
    return `${origin}${path}${path.includes('?') ? '&' : '?'}gf_voucher=${order.id}&gf_token=${encodeURIComponent(token)}`;
  }

  const pay = guarded(async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const order = orderOf(req, body.token);
    if (!available()) throw new Refusal('ONLINE_SALE_UNAVAILABLE');
    if (order.state === 'issued') throw new Refusal('VOUCHER_ALREADY_ISSUED');
    if (order.linkId) {
      const known = await payments.refreshLink(order.linkId);
      if (DEAD_LINK.has(known)) throw new Refusal('PAYMENT_LINK_EXPIRED');
      if (known === 'paid') throw new Refusal('PAYMENT_PENDING');
    }
    const started = await offerService.startPayment(order.id, { returnUrl: returnUrlOf(order, body.token, body.returnPath) });
    if (!started.ok) throw new Refusal(started.code, started.message);
    return respond.ok(res, { paymentUrl: started.url });
  });

  /**
 * Rule 20 — the order's state and, once the bank confirmed, the voucher. Reading it asks the bank again while it is pending; a link that
 * lapsed unpaid (rule 16, one hour) answers `link-expired`, and a payment confirmed after that still issues the voucher (rule 45).
 */
  const status = guarded(async (req, res) => {
    let order = orderOf(req, req.query.token);
    let linkStatus = null;
    if (order.state === 'pending' && order.linkId) {
      linkStatus = await payments.refreshLink(order.linkId);
      order = orders.find(order.id);
    }
    res.set('Cache-Control', 'no-store');
    const voucher = vouchers.findByOrderId(order.id);
    if (!voucher) return respond.ok(res, { state: DEAD_LINK.has(linkStatus) ? 'link-expired' : 'pending' });
    const state = rules.stateOf({ voucher, balanceCents: voucher.balanceCents, today: rules.parisDate(now()) });
    const plain = state === 'cancelled' ? null : readCode(voucher);
    return respond.ok(res, {
      state,
      voucher: {
        number: voucher.number,
        brand: brand(),
        amountCents: voucher.amountCents,
        balanceCents: voucher.balanceCents,
        expiresOn: voucher.expiresOn,
        recipientName: voucher.recipientName,
        senderName: voucher.senderName,
        message: voucher.message,
        code: plain,
      },
    });
  });

  const pdf = guarded(async (req, res) => {
    const order = orderOf(req, req.query.token);
    const voucher = vouchers.findByOrderId(order.id);
    const plain = voucher && !voucher.cancelledAt ? readCode(voucher) : null;
    const url = bookingUrl();
    if (!plain || !url) throw new Refusal('VOUCHER_ORDER_NOT_FOUND');
    const buffer = await renderPdf({
      brand: brand(), bookingUrl: url, language: req.query.lang === 'en' ? 'en' : voucher.language, voucher: { ...voucher, code: plain },
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${voucher.number}.pdf"`, 'Cache-Control': 'no-store' });
    return res.send(buffer);
  });

  return {
    read, price, create, pay, status, pdf,
  };
}

module.exports = { buildPublicOrdersController, ORDERS_PER_HOUR };
