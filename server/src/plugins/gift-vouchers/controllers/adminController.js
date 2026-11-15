/**
 * `/api/gift-vouchers/**` — the operator's side (specs/gift-vouchers.md rules 24-28, §4.3). Thin handlers over the models
 * and rules: they validate the shape of what they receive, ask the models, and answer. Every action that changes a voucher
 * writes a movement carrying its author (rule 25).
 */

const crypto = require('crypto');
const code = require('../code');
const rules = require('../voucherRules');
const { renderMail } = require('../mailTemplate');

const MAX_NAME = 40;
const MAX_MESSAGE = 200;
const MAX_REASON = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REFUSALS = Object.freeze({
  BODY_INVALID: [400, 'Corps de requête invalide.'],
  FIELD_INVALID: [400, 'Champ invalide.'],
  AMOUNT_INVALID: [400, 'Montant invalide : un nombre entier de centimes.'],
  VOUCHER_AMOUNT_OUT_OF_BOUNDS: [400, 'Montant hors des bornes.'],
  EMAIL_INVALID: [400, 'Adresse e-mail invalide.'],
  PAYMENT_METHOD_INVALID: [400, 'Moyen de paiement inconnu.'],
  DATE_INVALID: [400, 'Date invalide.'],
  DATE_NOT_IN_FUTURE: [400, 'La nouvelle date doit être dans le futur.'],
  DATE_IN_FUTURE: [400, 'La date de vente ne peut pas être dans le futur.'],
  REASON_REQUIRED: [400, 'Un motif est demandé.'],
  VOUCHER_NOT_FOUND: [404, 'Bon introuvable.'],
  VOUCHER_CANCELLED: [409, 'Ce bon est annulé.'],
  VOUCHER_ALREADY_REDEEMED: [409, 'Ce bon a déjà servi : il ne peut plus être annulé.'],
  NO_EMAIL: [409, 'Aucune adresse e-mail sur ce bon.'],
  NO_PAGE_URL: [409, 'L’adresse de la page du bon est à renseigner dans les réglages.'],
  BALANCE_BELOW_ZERO: [422, 'Le solde ne peut pas passer sous 0.'],
  BALANCE_ABOVE_ISSUED: [422, 'Le solde ne peut pas dépasser le montant du bon.'],
  MAIL_FAILED: [502, 'Le mail n’est pas parti.'],
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class Refusal extends Error {
  constructor(refusalCode) {
    super(refusalCode);
    this.code = refusalCode;
  }
}

/** An optional text of at most `max` characters; a non-string is refused, never coerced. */
function optionalText(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Refusal('FIELD_INVALID');
  return value.trim();
}

function buildAdminController({
  vouchers, orders, movements, issuance, transaction, limits, paymentMethods, decrypt, sendMail, renderPdf,
  settingsGet, brand, pageUrl, bookingUrl, now = () => new Date(),
}) {
  const today = () => rules.parisDate(now());
  const actorOf = (req) => `user:${req.user && req.user.id ? req.user.id : 'unknown'}`;
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };

  function answer(res, error) {
    const refusal = REFUSALS[error && error.code];
    if (!refusal) throw error;
    return res.status(refusal[0]).json({ error: refusal[1], code: error.code });
  }

  const guarded = (handler) => async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return answer(res, error);
    }
  };

  const bodyOf = (req) => {
    if (!isObject(req.body)) throw new Refusal('BODY_INVALID');
    return req.body;
  };

  const stateOf = (v) => rules.stateOf({ voucher: v, balanceCents: v.balanceCents, today: today() });

  const summary = (v) => ({
    id: v.id,
    number: v.number,
    state: stateOf(v),
    amountCents: v.amountCents,
    balanceCents: v.balanceCents,
    issuedAt: v.issuedAt,
    expiresOn: v.expiresOn,
    cancelledAt: v.cancelledAt,
    buyerEmail: v.email,
    senderName: v.senderName,
    recipientName: v.recipientName,
    source: v.source,
    paymentMethod: v.paymentMethod,
    mailSentAt: v.mailSentAt,
    mailError: v.mailError,
  });

  const find = (req) => {
    const id = idOf(req);
    const v = id ? vouchers.find(id) : null;
    if (!v) throw new Refusal('VOUCHER_NOT_FOUND');
    return v;
  };

  const readCode = (v) => {
    const read = decrypt(v.codeEncrypted);
    return read.ok ? read.value : null;
  };

  const detail = (v) => {
    const plain = readCode(v);
    return {
      ...summary(v),
      message: v.message,
      codeMasked: plain ? code.mask(plain) : null,
      canCancel: !v.cancelledAt && !movements.hasKind(v.id, 'redeem'),
      movements: movements.list(v.id),
    };
  };

  const list = guarded((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (state && !rules.STATES.includes(state)) throw new Refusal('FIELD_INVALID');
    const all = vouchers.listAll().map((v) => ({ v, row: summary(v) }));
    const outstandingCents = all.filter(({ row }) => row.state !== 'cancelled').reduce((sum, { row }) => sum + row.balanceCents, 0);
    const items = all
      .filter(({ row, v }) => (!state || row.state === state)
        && (!q || [v.number, v.email, v.senderName, v.recipientName].some((field) => String(field || '').toLowerCase().includes(q))))
      .map(({ row }) => row);
    return res.json({ items, outstandingCents });
  });

  const read = guarded((req, res) => res.json(detail(find(req))));

  const create = guarded((req, res) => {
    const body = bodyOf(req);
    const amount = rules.checkAmountCents(body.amountCents, limits());
    if (!amount.ok) throw new Refusal(amount.code);
    const email = optionalText(body.email, 254);
    if (email && !EMAIL.test(email)) throw new Refusal('EMAIL_INVALID');
    if (typeof body.paymentMethod !== 'string' || !paymentMethods().includes(body.paymentMethod)) throw new Refusal('PAYMENT_METHOD_INVALID');
    let issueDate = today();
    if (body.date !== undefined && body.date !== null) {
      if (typeof body.date !== 'string' || !rules.isIsoDate(body.date)) throw new Refusal('DATE_INVALID');
      if (body.date > issueDate) throw new Refusal('DATE_IN_FUTURE');
      issueDate = body.date;
    }
    const actor = actorOf(req);
    const created = transaction(() => {
      const order = orders.create({
        amountCents: amount.cents,
        recipientName: optionalText(body.recipientName, MAX_NAME),
        senderName: optionalText(body.senderName, MAX_NAME),
        message: optionalText(body.message, MAX_MESSAGE),
        email,
        language: body.language === 'en' ? 'en' : 'fr',
        source: 'manual',
        paymentMethod: body.paymentMethod,
        createdBy: actor,
      });
      return issuance.issue({
        orderId: order.id, actor, validityMonths: limits().validityMonths, issueDate,
      });
    });
    return res.status(201).json(detail(vouchers.find(created.voucherId)));
  });

  const key = (kind, id) => `${kind}:${id}:${crypto.randomUUID()}`;

  const live = (v) => {
    if (v.cancelledAt) throw new Refusal('VOUCHER_CANCELLED');
    return v;
  };

  const extend = guarded((req, res) => {
    const v = live(find(req));
    const { expiresOn } = bodyOf(req);
    const refusal = rules.extensionRefusal({ expiresOn, today: today() });
    if (refusal) throw new Refusal(refusal);
    transaction(() => {
      movements.append({
        voucherId: v.id, kind: 'extend', actor: actorOf(req), note: `${v.expiresOn} → ${expiresOn}`, idempotencyKey: key('extend', v.id),
      });
      vouchers.setExpiry(v.id, expiresOn);
    });
    return res.json(detail(vouchers.find(v.id)));
  });

  const cancel = guarded((req, res) => {
    const v = live(find(req));
    if (movements.hasKind(v.id, 'redeem')) throw new Refusal('VOUCHER_ALREADY_REDEEMED');
    transaction(() => {
      movements.append({
        voucherId: v.id, kind: 'cancel', amountCents: -movements.balanceOf(v.id), actor: actorOf(req), idempotencyKey: `cancel:${v.id}`,
      });
      vouchers.setCancelled(v.id, now().toISOString());
    });
    return res.json(detail(vouchers.find(v.id)));
  });

  const adjust = guarded((req, res) => {
    const v = live(find(req));
    const body = bodyOf(req);
    const reason = optionalText(body.reason, MAX_REASON);
    if (!reason) throw new Refusal('REASON_REQUIRED');
    if (typeof body.amountCents !== 'number' || !Number.isSafeInteger(body.amountCents) || body.amountCents === 0) throw new Refusal('AMOUNT_INVALID');
    try {
      movements.append({
        voucherId: v.id, kind: 'adjust', amountCents: body.amountCents, actor: actorOf(req), note: reason, idempotencyKey: key('adjust', v.id),
      });
    } catch (error) {
      if (error.code === 'MOVEMENT_AMOUNT_INVALID') throw new Refusal('AMOUNT_INVALID');
      throw error;
    }
    return res.json(detail(vouchers.find(v.id)));
  });

  const reveal = guarded((req, res) => {
    const v = find(req);
    const plain = readCode(v);
    if (!plain) return res.status(409).json({ error: 'Le code ne peut plus être relu : la clé de chiffrement a changé.', code: 'CODE_UNREADABLE' });
    movements.append({
      voucherId: v.id, kind: 'reveal', actor: actorOf(req), idempotencyKey: key('reveal', v.id),
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ code: code.format(plain) });
  });

  const resend = guarded(async (req, res) => {
    const v = live(find(req));
    if (!v.email) throw new Refusal('NO_EMAIL');
    const base = pageUrl();
    const token = orders.tokenOf(v.orderId);
    if (!base || !token) throw new Refusal('NO_PAGE_URL');
    const link = `${base.replace(/#.*$/, '')}${base.includes('?') ? '&' : '?'}gf_voucher=${v.orderId}&gf_token=${token}`;
    const mail = renderMail({ voucher: v, link, language: v.language }, settingsGet);
    try {
      await sendMail({ to: v.email, ...mail, key: `gift-voucher:${v.id}` });
    } catch (error) {
      vouchers.setMail(v.id, { error: String(error && error.message ? error.message : error).slice(0, 200) });
      throw new Refusal('MAIL_FAILED');
    }
    transaction(() => {
      vouchers.setMail(v.id, { sentAt: now().toISOString() });
      movements.append({
        voucherId: v.id, kind: 'mail', actor: actorOf(req), idempotencyKey: key('mail', v.id),
      });
    });
    return res.json(detail(vouchers.find(v.id)));
  });

  const pdf = guarded(async (req, res) => {
    const v = find(req);
    const plain = readCode(v);
    const url = bookingUrl();
    if (!plain) return res.status(409).json({ error: 'Le code ne peut plus être relu : la clé de chiffrement a changé.', code: 'CODE_UNREADABLE' });
    if (!url) throw new Refusal('NO_PAGE_URL');
    const buffer = await renderPdf({
      brand: brand(), bookingUrl: url, language: v.language, voucher: { ...v, code: plain },
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${v.number}.pdf"`, 'Cache-Control': 'no-store' });
    return res.send(buffer);
  });

  return {
    list, read, create, extend, cancel, adjust, reveal, resend, pdf,
  };
}

module.exports = { buildAdminController };
