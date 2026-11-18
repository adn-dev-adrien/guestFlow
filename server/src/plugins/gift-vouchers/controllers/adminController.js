/**
 * `/api/gift-vouchers/**` — the operator's side (specs/gift-vouchers.md rules 24-28, §4.3). Thin handlers over the models
 * and rules: they validate the shape of what they receive, ask the models, and answer. Every action that changes a voucher
 * writes a movement carrying its author (rule 25). A voucher is sold through the same `offerService` as on the site (specs/gift-voucher-campaigns.md
 * rules 41, 52): this side adds the session and the three outcomes — « Payé », « Offert », « Envoyer un lien ».
 */

const crypto = require('crypto');
const code = require('../code');
const rules = require('../voucherRules');
const { presentMovement, actorNameOf } = require('../movementView');
const { statusOf } = require('../offerService');
const { renderPaymentLinkMail } = require('../mailTemplate');
const { DOCUMENT_REFUSALS } = require('../documentRefusals');

const OUTCOMES = Object.freeze(['paid', 'offered', 'link']);
const REQUEST_KEYS = Object.freeze(['slug', 'composition', 'title', 'validityMonths', 'offeredAddOns', 'extraTimeMaxMinutes', 'extraMinutes', 'addOns', 'amountCents']);
const MAX_REASON = 200;
const MAX_EMAIL = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REFUSALS = Object.freeze({
  BODY_INVALID: [400, 'Corps de requête invalide.'],
  FIELD_INVALID: [400, 'Champ invalide.'],
  AMOUNT_INVALID: [400, 'Montant invalide : un nombre entier de centimes.'],
  VOUCHER_AMOUNT_OUT_OF_BOUNDS: [400, 'Montant hors des bornes.'],
  EMAIL_INVALID: [400, 'Adresse e-mail invalide.'],
  OUTCOME_INVALID: [400, 'Issue invalide : payé, offert ou envoyer un lien.'],
  PAYMENT_METHOD_INVALID: [400, 'Moyen de paiement inconnu.'],
  DATE_INVALID: [400, 'Date invalide.'],
  DATE_NOT_IN_FUTURE: [400, 'La nouvelle date doit être dans le futur.'],
  DATE_IN_FUTURE: [400, 'La date de vente ne peut pas être dans le futur.'],
  REASON_REQUIRED: [400, 'Un motif est demandé.'],
  VOUCHER_NOT_FOUND: [404, 'Bon introuvable.'],
  VOUCHER_CANCELLED: [409, 'Ce bon est annulé.'],
  VOUCHER_ALREADY_REDEEMED: [409, 'Ce bon a déjà servi : il ne peut plus être annulé.'],
  VOUCHER_NOT_USABLE: [409, 'Ce bon n’est plus utilisable (utilisé, expiré ou annulé) : il ne peut plus être téléchargé ni renvoyé.'],
  VOUCHER_EXPIRED: [409, 'Ce bon est expiré : il ne peut plus être annulé.'],
  CANCEL_FORCE_REQUIRED: [409, 'Le délai de rétractation de 14 jours est écoulé : annuler ce bon est un geste commercial, à confirmer avec un motif.'],
  REFUND_NOT_FOUND: [404, 'Remboursement introuvable.'],
  REFUND_ALREADY_SETTLED: [409, 'Ce remboursement est déjà marqué comme effectué.'],
  NO_EMAIL: [409, 'Aucune adresse e-mail sur ce bon.'],
  ...DOCUMENT_REFUSALS,
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

/** An optional text of at most `max` characters; a non-string is refused, never coerced (the reason of a correction). */
function optionalText(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Refusal('FIELD_INVALID');
  return value.trim();
}

function buildAdminController({
  vouchers, movements, refunds, redemption, documents, offerService, campaigns, transaction, paymentMethods, userName = () => null, decrypt, receipt, sendMail, now = () => new Date(), terms = null, siteOrigin = () => '', uses = null, unused = null, lapseUses = () => {},
}) {
  const today = () => rules.parisDate(now());
  const actorOf = (req) => `user:${req.user && req.user.id ? req.user.id : 'unknown'}`;
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };

  function answer(res, error) {
    const refusal = REFUSALS[error && error.code];
    if (!refusal) throw error;
    return res.status(refusal[0]).json({ error: refusal[1], code: error.code });
  }

  /** A refusal of the shared sale service: the operator's own sentence for a code this side words, else the service's. */
  function answerSale(res, result) {
    const known = REFUSALS[result.code];
    return res.status(known ? known[0] : statusOf(result.code)).json({
      error: known ? known[1] : result.message, code: result.code, ...(result.errors ? { errors: result.errors } : {}),
    });
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
    kind: rules.contentsOf(v).kind,
    campaignId: v.campaignId,
    campaignName: v.campaignId && campaigns.find(v.campaignId) ? campaigns.find(v.campaignId).name : null,
    offered: v.paymentMethod === rules.OFFERED_METHOD,
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
    canDownload: rules.isUsable(stateOf(v)),
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

  /** Rule 29 — the session a recipient booked with the voucher, for the link to its fiche. */
  const bathOf = (v) => {
    const booked = uses ? uses.bookedOf(v.id) : null;
    return booked ? {
      bookingId: booked.bookingId, date: booked.date, startTime: booked.startTime, endTime: booked.endTime, usedOn: rules.parisDate(new Date(booked.settledAt)),
    } : null;
  };

  /** Rule 15 — « Écart non utilisé » : what the voucher paid for that the client did not take, at the day's prices. */
  const unusedOf = (v) => {
    const rows = unused ? unused.listByVoucher(v.id) : [];
    return {
      unusedCents: rows.reduce((sum, row) => sum + row.valueCents, 0),
      unused: rows.map((row) => ({ label: row.label, valueCents: row.valueCents, on: rules.parisDate(new Date(row.at)) })),
    };
  };

  const detail = (v) => {
    const plain = readCode(v);
    return {
      ...summary(v),
      message: v.message,
      contents: rules.contentsOf(v),
      oneShot: Boolean(v.campaignId && campaigns.find(v.campaignId) && campaigns.find(v.campaignId).oneShot),
      vatLines: summary(v).offered ? [] : rules.vatLinesOf(v),
      vat: summary(v).offered || rules.vatLinesOf(v).length !== 1 ? null : rules.vatLinesOf(v)[0],
      codeMasked: plain ? code.mask(plain) : null,
      canCancel: !v.cancelledAt && !movements.hasKind(v.id, 'redeem') && stateOf(v) !== 'expired',
      withdrawal: summary(v).offered ? null : rules.withdrawalOf({ paidOn: rules.parisDate(new Date(v.issuedAt)), today: today() }),
      cancelReason: v.cancelReason,
      cancelForced: Boolean(v.cancelForced),
      bath: bathOf(v),
      ...unusedOf(v),
      refunds: refunds.listByVoucher(v.id).map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        openedOn: rules.parisDate(new Date(r.openedAt)),
        settledOn: r.settledAt ? rules.parisDate(new Date(r.settledAt)) : null,
        settledBy: r.settledBy ? actorNameOf(r.settledBy, userName) : null,
      })),
      movements: [
        ...movements.list(v.id).map((m) => presentMovement(m, userName)),
        ...refunds.listByVoucher(v.id).filter((r) => r.settledAt).map((r) => ({
          id: `refund:${r.id}`,
          kind: 'refundSettled',
          label: 'Remboursement effectué',
          amountCents: r.amountCents,
          date: rules.parisDate(new Date(r.settledAt)),
          actorName: actorNameOf(r.settledBy, userName),
          reservationId: null,
          note: null,
        })),
      ],
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
    return res.json({ items, outstandingCents, paymentMethods: paymentMethods() });
  });

  const read = guarded((req, res) => res.json(detail(find(req))));

  /** The voucher asked for, as the sale service reads it: a campaign's slug (none = the lodging voucher) or a one-shot composition, with what the buyer chose. */
  const requestOf = (body) => Object.fromEntries(REQUEST_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

  // Rule 37 — paying the link accepts the terms of the voucher's activity: the mail names them and links their current version.
  function termsUrlOf(request) {
    const found = offerService.activityOf(request, { admin: true });
    const current = found.ok && terms ? terms.current(found.activity) : null;
    const origin = String(siteOrigin() || '').trim().replace(/\/+$/, '');
    if (!current || !origin) return '';
    return found.activity === 'lodging' ? `${origin}/cgv/?v=${current.version}` : `${origin}/cgv/?activity=${encodeURIComponent(found.activity)}&v=${current.version}`;
  }

  async function sendLink({
    orderId, email, language, url, label, termsUrl,
  }) {
    try {
      await sendMail({ to: email, ...renderPaymentLinkMail({ url, language, label, termsUrl }), key: `gift-voucher-link:${orderId}` });
    } catch {
      throw new Refusal('MAIL_FAILED');
    }
  }

  const create = guarded(async (req, res) => {
    const body = bodyOf(req);
    const outcome = body.outcome === undefined ? 'paid' : body.outcome;
    if (!OUTCOMES.includes(outcome)) throw new Refusal('OUTCOME_INVALID');
    const parties = offerService.partiesOf(body, { emailRequired: outcome === 'link' });
    if (!parties.ok) throw new Refusal(parties.code);
    const actor = actorOf(req);
    if (outcome === 'link') {
      const created = offerService.createOrder({
        request: requestOf(body), parties: parties.value, source: 'site', createdBy: actor, admin: true,
      });
      if (!created.ok) return answerSale(res, created);
      const started = await offerService.startPayment(created.order.id);
      if (!started.ok) return answerSale(res, started);
      await sendLink({
        orderId: created.order.id, email: parties.value.email, language: parties.value.language, url: started.url, label: started.label, termsUrl: termsUrlOf(requestOf(body)),
      });
      return res.status(201).json({
        orderId: created.order.id, outcome, emailedTo: parties.value.email, totalCents: started.totalCents,
      });
    }
    if (outcome === 'paid' && (typeof body.paymentMethod !== 'string' || !paymentMethods().some((m) => m.value === body.paymentMethod))) throw new Refusal('PAYMENT_METHOD_INVALID');
    let issueDate = today();
    if (body.date !== undefined && body.date !== null) {
      if (typeof body.date !== 'string' || !rules.isIsoDate(body.date)) throw new Refusal('DATE_INVALID');
      if (body.date > issueDate) throw new Refusal('DATE_IN_FUTURE');
      issueDate = body.date;
    }
    const issued = offerService.issueDirect({
      request: requestOf(body), parties: parties.value, outcome, paymentMethod: body.paymentMethod, actor, issueDate,
    });
    if (!issued.ok) return answerSale(res, issued);
    return res.status(201).json(detail(vouchers.find(issued.voucherId)));
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

  /**
   * Rules 39, 54 — « Annuler le bon »: the holds go back, the balance leaves, and the paid amount becomes a refund line the books carry as an avoir dated today. Within the 14 days
   * of the payment it is a withdrawal; after them only a goodwill cancellation (`force` with a reason). A voucher given away has no payment, so no refund and no period.
   */
  const cancel = guarded((req, res) => {
    const body = isObject(req.body) ? req.body : {};
    if (body.force !== undefined && typeof body.force !== 'boolean') throw new Refusal('FIELD_INVALID');
    const reason = optionalText(body.reason, MAX_REASON);
    const v = live(find(req));
    if (movements.hasKind(v.id, 'redeem')) throw new Refusal('VOUCHER_ALREADY_REDEEMED');
    if (stateOf(v) === 'expired') throw new Refusal('VOUCHER_EXPIRED');
    const offered = v.paymentMethod === rules.OFFERED_METHOD;
    const late = !offered && !rules.withdrawalOf({ paidOn: rules.parisDate(new Date(v.issuedAt)), today: today() }).open;
    if (late && body.force !== true) throw new Refusal('CANCEL_FORCE_REQUIRED');
    if (late && !reason) throw new Refusal('REASON_REQUIRED');
    transaction(() => {
      lapseUses(v.id);
      redemption.releaseHoldsOf(v.id, 'cancelled');
      const owed = movements.balanceOf(v.id);
      movements.append({
        voucherId: v.id, kind: 'cancel', amountCents: -owed, actor: actorOf(req), note: reason || null, idempotencyKey: `cancel:${v.id}`,
      });
      vouchers.setCancelled(v.id, now().toISOString(), { reason: reason || null, forced: late });
      if (!offered && owed > 0) refunds.open({ voucherId: v.id, amountCents: owed });
    });
    return res.json(detail(vouchers.find(v.id)));
  });

  /** Rule 54 — the operator made the transfer: the refund line is marked settled, with their name. */
  const settleRefund = guarded((req, res) => {
    const v = find(req);
    const refund = refunds.find(req.params.rid);
    if (!refund || refund.voucherId !== v.id) throw new Refusal('REFUND_NOT_FOUND');
    if (!refunds.settle(refund.id, actorOf(req))) throw new Refusal('REFUND_ALREADY_SETTLED');
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
    if (!plain) throw new Refusal('CODE_UNREADABLE');
    movements.append({
      voucherId: v.id, kind: 'reveal', actor: actorOf(req), idempotencyKey: key('reveal', v.id),
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ code: code.format(plain) });
  });

  /** Rule 48 — a voucher used, expired or cancelled is neither downloaded nor mailed again. */
  const downloadable = (v) => {
    live(v);
    if (!rules.isUsable(stateOf(v))) throw new Refusal('VOUCHER_NOT_USABLE');
    return v;
  };

  /** Rule 49 — « Renvoyer le mail »: to the giver's address, or to the one the operator typed. */
  const resend = guarded(async (req, res) => {
    const v = downloadable(find(req));
    const body = isObject(req.body) ? req.body : {};
    if (body.email !== undefined && body.email !== null && (typeof body.email !== 'string' || (body.email.trim() && !EMAIL.test(body.email.trim())) || body.email.length > MAX_EMAIL)) throw new Refusal('EMAIL_INVALID');
    const typed = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
    await receipt.deliver(v, { actor: actorOf(req), idempotencyKey: receipt.manualKey(v.id), to: typed });
    return res.json(detail(vouchers.find(v.id)));
  });

  const pdf = guarded(async (req, res) => {
    const v = downloadable(find(req));
    const buffer = await documents.voucherPdf(v);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${v.number}.pdf"`, 'Cache-Control': 'no-store' });
    return res.send(buffer);
  });

  return {
    list, read, create, extend, cancel, settleRefund, adjust, reveal, resend, pdf,
  };
}

module.exports = { buildAdminController };
