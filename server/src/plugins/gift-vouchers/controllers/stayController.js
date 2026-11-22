/**
 * `/api/gift-vouchers/stays/:reservationId/**` — a voucher on a fiche (specs/gift-vouchers.md rules 40-41). The fiche's card
 * (`reservation.cards`) reads one payload and renders it: the operator pays part of a confirmed stay with a voucher, takes that
 * payment back, and, once the stay is cancelled, re-credits the voucher part — never a refund in money.
 *
 * What a payment writes on the stay is the core's (`prepaidReceipts`): a settlement with a prepaid line. What it writes on the
 * voucher is the plugin's: a `redeem`, or the `refund` that undoes it. Both happen in one transaction.
 */

const code = require('../code');
const rules = require('../voucherRules');
const { LABEL, SOURCE } = require('../redemption');

const REFUSALS = Object.freeze({
  BODY_INVALID: [400, 'Corps de requête invalide.'],
  AMOUNT_INVALID: [400, 'Montant invalide : un nombre entier de centimes.'],
  CODE_REQUIRED: [400, 'Le code du bon est demandé.'],
  VOUCHER_CODE_MISTYPED: [400, 'Code mal recopié : vérifier chaque caractère.'],
  VOUCHER_UNKNOWN: [404, 'Code inconnu.'],
  VOUCHER_EXPIRED: [409, 'Ce bon a expiré.'],
  VOUCHER_EXHAUSTED: [409, 'Ce bon est entièrement utilisé.'],
  AMOUNT_ABOVE_BALANCE: [422, 'Le montant dépasse le solde du bon.'],
  STAY_NOT_FOUND: [404, 'Séjour introuvable.'],
  STAY_NOT_CONFIRMED: [409, 'Seul un séjour confirmé se paie par bon cadeau.'],
  STAY_NOT_CANCELLED: [409, 'Le séjour n’est pas annulé.'],
  PAYMENT_NOT_FOUND: [404, 'Paiement introuvable.'],
  RECORD_REFUSED: [409, 'Paiement refusé.'],
  UNDO_REFUSED: [409, 'Annulation refusée.'],
  NOTHING_TO_RECREDIT: [409, 'Rien à recréditer.'],
});

class Refusal extends Error {
  constructor(refusalCode, status = null, message = null) {
    super(refusalCode);
    this.code = refusalCode;
    this.status = status || (REFUSALS[refusalCode] || [500])[0];
    this.text = message || (REFUSALS[refusalCode] || [0, 'Erreur.'])[1];
  }
}

function buildStayController({
  vouchers, movements, redemption, pepper, transaction, stayOf, collectedCents, receipts, now = () => new Date(),
}) {
  const today = () => rules.parisDate(now());
  const actorOf = (req) => `user:${req.user && req.user.id ? req.user.id : 'unknown'}`;
  const stayIdOf = (req) => { const n = Number(req.params.reservationId); return Number.isInteger(n) && n > 0 ? n : null; };
  const send = (res, err) => {
    if (err instanceof Refusal) return res.status(err.status).json({ error: err.code, message: err.text });
    throw err;
  };

  /** The vouchers redeemed on a stay and what each is still owed back. */
  function redeemedOn(stayId) {
    const rows = movements.listByReservation(stayId);
    const byVoucher = new Map();
    rows.forEach((m) => {
      if (!['redeem', 'refund'].includes(m.kind)) return;
      byVoucher.set(m.voucherId, (byVoucher.get(m.voucherId) || 0) - m.amountCents);
    });
    return [...byVoucher.entries()].map(([voucherId, cents]) => ({ voucherId, netCents: cents })).filter((v) => v.netCents > 0);
  }

  /** Rule 40 — what a cancelled stay lets the operator give back to the voucher: what the cancellation kept comes off the card first. */
  function recreditable(stayId, stay) {
    const used = redeemedOn(stayId);
    const voucherCents = used.reduce((sum, v) => sum + v.netCents, 0);
    if (voucherCents <= 0) return { voucherCents: 0, recreditCents: 0, used };
    const keptCents = Math.max(0, Number(stay.cancellationKeptCents || 0));
    const otherCents = Math.max(0, collectedCents(stay) - voucherCents);
    const recreditCents = Math.max(0, voucherCents - Math.max(0, keptCents - otherCents));
    return { voucherCents, recreditCents, used };
  }

  function payload(stayId) {
    const stay = stayOf(stayId);
    if (!stay) throw new Refusal('STAY_NOT_FOUND');
    const confirmed = stay.kind === 'reservation';
    // One line per payment: a payment may have paid the acompte and the solde, each with a settlement of its own.
    const byRef = new Map();
    receipts.receivedOn(stayId).forEach((r) => {
      const line = byRef.get(String(r.ref)) || {
        ref: String(r.ref), amountCents: 0, paidDate: r.paidDate, buckets: [], undoable: confirmed,
      };
      line.amountCents += r.amountCents;
      line.buckets.push(r.bucket);
      line.undoable = line.undoable && r.onlyPrepaid && !movements.byKey(`refund:undo:${r.ref}`);
      byRef.set(String(r.ref), line);
    });
    const lines = [...byRef.values()].map((line) => {
      const voucher = vouchers.find(movements.byId(line.ref).voucherId);
      return { ...line, label: voucher ? `${LABEL} ${voucher.number}` : LABEL };
    });
    const out = {
      reservationId: stayId, kind: stay.kind, canPay: confirmed, owedCents: confirmed ? receipts.owedCentsOn(stayId) : 0, lines,
    };
    if (stay.kind === 'cancelled') {
      const offer = recreditable(stayId, stay);
      out.recredit = { voucherCents: offer.voucherCents, recreditCents: offer.recreditCents, keptCents: Number(stay.cancellationKeptCents || 0) };
    }
    return out;
  }

  /** The voucher a typed code names, usable now. The fiche is not subject to the public limits (rule 33). */
  function usableVoucher(typed) {
    if (typeof typed !== 'string' || !typed.trim()) throw new Refusal('CODE_REQUIRED');
    const normalised = code.normalise(typed.slice(0, 64));
    if (!code.hasValidCheck(normalised)) throw new Refusal('VOUCHER_CODE_MISTYPED');
    const voucher = vouchers.findByCodeHash(code.hashCode(pepper(), normalised));
    if (!voucher || voucher.cancelledAt) throw new Refusal('VOUCHER_UNKNOWN');
    const state = rules.stateOf({ voucher, balanceCents: voucher.balanceCents, today: today() });
    if (state === 'expired') throw new Refusal('VOUCHER_EXPIRED');
    if (state === 'exhausted') throw new Refusal('VOUCHER_EXHAUSTED');
    return voucher;
  }

  const read = (req, res) => {
    try { return res.json(payload(stayIdOf(req))); } catch (err) { return send(res, err); }
  };

  /** Rule 40 — « Payer par bon cadeau »: the voucher is redeemed and the stay receives the same amount. */
  const pay = (req, res) => {
    try {
      const stayId = stayIdOf(req);
      const stay = stayOf(stayId);
      if (!stay) throw new Refusal('STAY_NOT_FOUND');
      if (stay.kind !== 'reservation') throw new Refusal('STAY_NOT_CONFIRMED');
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
      if (!body) throw new Refusal('BODY_INVALID');
      if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) throw new Refusal('AMOUNT_INVALID');
      const voucher = usableVoucher(body.code);
      if (body.amountCents > voucher.balanceCents) throw new Refusal('AMOUNT_ABOVE_BALANCE');
      transaction(() => {
        const { movement } = movements.append({
          voucherId: voucher.id,
          kind: 'redeem',
          amountCents: -body.amountCents,
          actor: actorOf(req),
          reservationId: stayId,
          idempotencyKey: `redeem:stay:${stayId}:${movements.countKindOn(stayId, 'redeem') + 1}`,
        });
        const recorded = receipts.recordOnStay({
          stayId, source: SOURCE, ref: movement.id, label: LABEL, amountCents: body.amountCents, paidDate: today(),
        });
        if (!recorded.ok) throw new Refusal('RECORD_REFUSED', recorded.status, recorded.error);
      });
      return res.json(payload(stayId));
    } catch (err) {
      if (err && err.code === 'BALANCE_BELOW_ZERO') return send(res, new Refusal('AMOUNT_ABOVE_BALANCE'));
      return send(res, err);
    }
  };

  /** Rule 40 — taking the payment back: a `refund` on the voucher, the received amount removed from the stay. */
  const undo = (req, res) => {
    try {
      const stayId = stayIdOf(req);
      const ref = String(req.params.ref || '');
      const found = receipts.receivedOn(stayId).find((r) => String(r.ref) === ref);
      if (!found) throw new Refusal('PAYMENT_NOT_FOUND');
      const redeem = redemption.redeemed(ref);
      if (!redeem) throw new Refusal('PAYMENT_NOT_FOUND');
      transaction(() => {
        const undone = receipts.undoOnStay({ stayId, source: SOURCE, ref });
        if (!undone.ok) throw new Refusal('UNDO_REFUSED', undone.status, undone.error);
        redemption.refund({
          voucherId: redeem.voucherId, amountCents: undone.removedCents, actor: actorOf(req), reservationId: stayId, idempotencyKey: `refund:undo:${ref}`, note: null,
        });
      });
      return res.json(payload(stayId));
    } catch (err) {
      return send(res, err);
    }
  };

  /** Rule 40 — « Recréditer le bon » on a cancelled stay. */
  const recredit = (req, res) => {
    try {
      const stayId = stayIdOf(req);
      const stay = stayOf(stayId);
      if (!stay) throw new Refusal('STAY_NOT_FOUND');
      if (stay.kind !== 'cancelled') throw new Refusal('STAY_NOT_CANCELLED');
      const offer = recreditable(stayId, stay);
      if (!(offer.recreditCents > 0)) throw new Refusal('NOTHING_TO_RECREDIT');
      transaction(() => {
        let left = offer.recreditCents;
        offer.used.forEach((v) => {
          const take = Math.min(left, v.netCents);
          if (!(take > 0)) return;
          redemption.refund({
            voucherId: v.voucherId, amountCents: take, actor: actorOf(req), reservationId: stayId, idempotencyKey: `refund:cancel:${stayId}:${v.voucherId}`, note: 'annulation',
          });
          left -= take;
        });
      });
      return res.json(payload(stayId));
    } catch (err) {
      if (err && err.code === 'BALANCE_ABOVE_ISSUED') return send(res, new Refusal('NOTHING_TO_RECREDIT'));
      return send(res, err);
    }
  };

  return {
    read, pay, undo, recredit, payload,
  };
}

module.exports = { buildStayController };
