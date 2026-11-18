/**
 * Using a voucher on a booking (specs/gift-vouchers.md rules 36-42): the plugin's side of `ctx.prepaid`, and of the fiche's
 * « Payer par bon cadeau ». Every movement goes through `movementsModel`, the only writer of a balance: a `hold` takes the amount
 * from the balance the moment a quote is created, a `release` gives it back (a quote refused, deleted or lapsed), and the quote
 * becoming a stay turns the hold into a `redeem`. The hold of a quote is never above the balance left, so two requests for the
 * same code cannot both take the last cents — the second is told what is left.
 */

const code = require('./code');
const rules = require('./voucherRules');
const { visitorHashOf } = require('./visitorHash');

const SOURCE = 'giftVoucher';
const LABEL = 'Bon cadeau';
// Rule 41 — a refund on an expired voucher re-credits it and extends it by this many months from that day.
const REFUND_EXTENSION_MONTHS = 3;
// A quote that holds a voucher and is never paid gives it back after this long (rule 37): longer than a payment link lives, so
// a link paid at its last minute still finds the hold it was minted for.
const HOLD_LIFETIME_MS = 72 * 60 * 60 * 1000;

const MESSAGES = Object.freeze({
  CHALLENGE_INVALID: 'Vérification impossible, recommencer.',
  VOUCHER_CODE_MISTYPED: 'Code mal recopié : vérifier chaque caractère.',
  VOUCHER_UNKNOWN: 'Code inconnu.',
  VOUCHER_EXPIRED: 'Ce bon a expiré.',
  VOUCHER_EXHAUSTED: 'Ce bon est entièrement utilisé.',
  VOUCHER_CHECKS_EXCEEDED: 'Trop d’essais. Nouvelle saisie possible plus tard.',
  VOUCHER_CHECKS_PAUSED: 'Vérification indisponible pour le moment.',
  VOUCHER_BALANCE_CHANGED: 'Le solde de ce bon a changé : vérifier à nouveau.',
  VOUCHER_WRONG_KIND: 'Ce bon ne convient pas à cet achat.',
  VOUCHER_CANCELLED: 'Ce bon a été annulé.',
});

const failure = (status, errorCode, extra = {}) => ({
  ok: false, status, code: errorCode, message: MESSAGES[errorCode], ...extra,
});

const lastFour = (normalised) => normalised.slice(-4);

function createRedemption({
  db, vouchers, movements, checks, limits, pepper, ipOf, resourceName = () => null, now = () => new Date(), transaction = (fn) => db.transaction(fn)(),
}) {
  const today = () => rules.parisDate(now());
  const visitorHashFor = (visitor) => visitorHashOf(pepper(), ipOf(visitor || {}));

  const holdsOf = (devisId) => db.prepare("SELECT * FROM gift_voucher_movements WHERE devisId = ? AND kind = 'hold' ORDER BY id").all(Number(devisId));
  const releaseKey = (hold) => `release:hold:${hold.id}`;
  const openHolds = (devisId) => holdsOf(devisId).filter((h) => !movements.byKey(releaseKey(h)));

  // A use holds its voucher once, and again when a payment lands after its first hold lapsed: the keys are `hold:use:<id>`, then `hold:use:<id>:2`, …
  const useHoldsOf = (useId) => db.prepare("SELECT * FROM gift_voucher_movements WHERE kind = 'hold' AND (idempotencyKey = ? OR idempotencyKey LIKE ?) ORDER BY id")
    .all(`hold:use:${Number(useId)}`, `hold:use:${Number(useId)}:%`);
  /** What the open holds of the uses on « Mon bain » keep from a voucher, in cents: a recipient coming back finds it again (rule 29). */
  const useHeldCents = (voucherId) => db.prepare(`SELECT * FROM gift_voucher_movements WHERE voucherId = ? AND kind = 'hold' AND idempotencyKey LIKE 'hold:use:%' ORDER BY id`)
    .all(Number(voucherId)).filter((h) => !movements.byKey(releaseKey(h))).reduce((sum, h) => sum - h.amountCents, 0);

  /**
   * Rule 33 — what a typed code is worth, judged like the public check: limits first, then the code. `forUse` (« Mon bain », rules 23-32) names a cancelled voucher
   * instead of calling it unknown, and sees what a use of its own holds as still there: the recipient who closed the page finds the voucher again.
   */
  function judgeCode(input, visitor, { forUse = false } = {}) {
    const visitorHash = visitorHashFor(visitor);
    const limited = limits.refusal(visitorHash);
    if (limited) return failure(429, limited.code, { retryAfterSeconds: limited.retryAfterSeconds });
    const normalised = code.normalise(typeof input.code === 'string' ? input.code.slice(0, 64) : '');
    if (!code.hasValidCheck(normalised)) {
      checks.record({ visitorHash, outcome: 'mistyped' });
      return failure(400, 'VOUCHER_CODE_MISTYPED');
    }
    const voucher = vouchers.findByCodeHash(code.hashCode(pepper(), normalised));
    if (!voucher || (voucher.cancelledAt && !forUse)) {
      checks.record({ visitorHash, outcome: 'unknown' });
      return failure(404, 'VOUCHER_UNKNOWN', { triesLeft: limits.triesLeft(visitorHash) });
    }
    if (voucher.cancelledAt) {
      checks.record({ visitorHash, outcome: 'exhausted' });
      return failure(409, 'VOUCHER_CANCELLED');
    }
    const balanceCents = voucher.balanceCents + (forUse ? useHeldCents(voucher.id) : 0);
    const state = rules.stateOf({ voucher, balanceCents, today: today() });
    checks.record({ visitorHash, outcome: rules.isUsable(state) ? 'usable' : state });
    if (state === 'expired') return failure(409, 'VOUCHER_EXPIRED', { expiresOn: voucher.expiresOn });
    if (state === 'exhausted') return failure(409, 'VOUCHER_EXHAUSTED', { voucherId: voucher.id });
    return { ok: true, voucher, normalised };
  }

  /**
   * Rule 12 — a voucher pays only for its kind: a lodging voucher is refused on a resource, a composed one on a stay and on any other resource than its own.
   * `consumer` is what the caller sells: `lodging`, or `resource:<id>`. → the refusal, or null.
   */
  function kindRefusal(voucher, consumer) {
    const contents = rules.contentsOf(voucher);
    const sold = String(consumer || 'lodging');
    const name = (id) => `« ${resourceName(id) || 'cette activité'} »`;
    if (contents.kind === 'lodging') {
      if (sold === 'lodging') return null;
      return failure(409, 'VOUCHER_WRONG_KIND', { message: `Ce bon est valable pour un séjour dans nos logements, pas pour ${name(Number(sold.split(':')[1]))}.` });
    }
    if (sold === `resource:${contents.resource.id}`) return null;
    const own = `« ${contents.resource.name} »`;
    return failure(409, 'VOUCHER_WRONG_KIND', {
      message: sold === 'lodging' ? `Ce bon est valable pour ${own}, pas pour un séjour.` : `Ce bon est valable pour ${own}, pas pour ${name(Number(sold.split(':')[1]))}.`,
    });
  }

  /**
   * `ctx.prepaid`'s `apply` (rule 36): the amount the code is worth on a quote, held for it unless `dryRun`. Never above
   * `capCents`, the stay's pre-arrival total. A hold lost to a concurrent one is answered with the balance left.
   */
  function apply({
    devisId, input, capCents, visitor, dryRun = false, consumer = 'lodging',
  }) {
    const judged = judgeCode(input, visitor);
    if (!judged.ok) return judged;
    const { voucher, normalised } = judged;
    const wrongKind = kindRefusal(voucher, consumer);
    if (wrongKind) return wrongKind;
    const heldCents = Math.min(voucher.balanceCents, Math.max(0, capCents));
    const display = { label: `${LABEL} ····${lastFour(normalised)}`, balanceCents: voucher.balanceCents };
    if (dryRun || !(heldCents > 0)) return { ok: true, heldCents, display };
    try {
      movements.append({
        voucherId: voucher.id,
        kind: 'hold',
        amountCents: -heldCents,
        actor: 'public',
        idempotencyKey: `hold:devis:${devisId}:${holdsOf(devisId).length + 1}`,
        devisId,
      });
    } catch (err) {
      if (err.code !== 'BALANCE_BELOW_ZERO') throw err;
      const left = vouchers.find(voucher.id).balanceCents;
      return failure(409, 'VOUCHER_BALANCE_CHANGED', { balanceCents: left });
    }
    return { ok: true, heldCents, display };
  }

  /** What is held for a quote now (the holds not yet released). */
  function held(devisId) {
    const open = openHolds(devisId);
    if (open.length === 0) return null;
    const voucher = vouchers.find(open[0].voucherId);
    return {
      amountCents: open.reduce((sum, h) => sum - h.amountCents, 0),
      display: { label: voucher ? `${LABEL} ${voucher.number}` : LABEL },
    };
  }

  function releaseHold(hold, reason) {
    movements.append({
      voucherId: hold.voucherId,
      kind: 'release',
      amountCents: -hold.amountCents,
      actor: 'system',
      note: reason || null,
      idempotencyKey: releaseKey(hold),
      devisId: hold.devisId,
    });
  }

  /** Rule 37 — gives back what a quote held: refused, deleted or lapsed unpaid. */
  function release({ devisId, reason }) {
    transaction(() => openHolds(devisId).forEach((h) => releaseHold(h, reason)));
  }

  /** Rule 54 — a voucher cancelled gives back every hold it still carries, whatever quote holds it. → how many. */
  function releaseHoldsOf(voucherId, reason) {
    const open = db.prepare("SELECT * FROM gift_voucher_movements WHERE voucherId = ? AND kind = 'hold' ORDER BY id").all(Number(voucherId))
      .filter((h) => !movements.byKey(releaseKey(h)));
    transaction(() => open.forEach((h) => releaseHold(h, reason)));
    return open.length;
  }

  /**
   * Rule 39 — the quote became the stay `reservationId` and uses `amountCents`: the hold is released and the same amount
   * redeemed, in one transaction. → `{ ref }` (the redeem movement), or null when nothing is used.
   */
  function settle({ devisId, reservationId, amountCents }) {
    const open = openHolds(devisId);
    if (open.length === 0) return null;
    let redeemed = null;
    transaction(() => {
      open.forEach((h) => releaseHold(h, 'converted'));
      if (!(amountCents > 0)) return;
      redeemed = movements.append({
        voucherId: open[0].voucherId,
        kind: 'redeem',
        amountCents: -amountCents,
        actor: 'public',
        reservationId,
        devisId,
        idempotencyKey: `redeem:devis:${devisId}`,
      }).movement;
    });
    return redeemed ? { ref: redeemed.id } : null;
  }

  /**
   * Rule 29 — a recipient's use of a composed voucher holds the voucher's whole balance for the 15 minutes a remainder is being paid: a voucher is used once and settled
   * whole (rule 13). → `{ ok: true, heldCents }`, or the refusal when the balance changed under the hold.
   */
  function holdForUse({ useId, voucherId }) {
    const balance = vouchers.find(voucherId).balanceCents;
    if (!(balance > 0)) return failure(409, 'VOUCHER_EXHAUSTED');
    try {
      movements.append({
        voucherId, kind: 'hold', amountCents: -balance, actor: 'public', idempotencyKey: `hold:use:${Number(useId)}${useHoldsOf(useId).length ? `:${useHoldsOf(useId).length + 1}` : ''}`,
      });
    } catch (err) {
      if (err.code !== 'BALANCE_BELOW_ZERO') throw err;
      return failure(409, 'VOUCHER_BALANCE_CHANGED', { balanceCents: vouchers.find(voucherId).balanceCents });
    }
    return { ok: true, heldCents: balance };
  }

  const openUseHold = (useId) => useHoldsOf(useId).find((hold) => !movements.byKey(releaseKey(hold))) || null;

  /** Rule 29 — the 15 minutes ended, or the use was replaced: the voucher is free again. → whether a hold was given back. */
  function releaseUse(useId, reason) {
    const hold = openUseHold(useId);
    if (!hold) return false;
    transaction(() => releaseHold(hold, reason));
    return true;
  }

  /** Rules 13, 29 — the bank confirmed and the session exists: the hold becomes a `redeem` of the whole balance, in the caller's transaction. → `{ ref }`. */
  function settleUse({ useId, bookingId }) {
    const hold = openUseHold(useId);
    if (!hold) return null;
    releaseHold(hold, 'converted');
    const redeemedMovement = movements.append({
      voucherId: hold.voucherId, kind: 'redeem', amountCents: hold.amountCents, actor: 'public', note: `Séance #${bookingId}`, idempotencyKey: `redeem:use:${Number(useId)}`,
    }).movement;
    return { ref: redeemedMovement.id };
  }

  /** Rule 37 — the holds a quote that never became a stay kept past their lifetime (a job). → how many were given back. */
  function releaseLapsed({ isConverted }) {
    const cutoff = new Date(now().getTime() - HOLD_LIFETIME_MS).toISOString();
    const lapsed = db.prepare("SELECT * FROM gift_voucher_movements WHERE kind = 'hold' AND createdAt < ? AND idempotencyKey NOT LIKE 'hold:use:%' ORDER BY id").all(cutoff)
      .filter((h) => !movements.byKey(releaseKey(h)) && !isConverted(h.devisId));
    transaction(() => lapsed.forEach((h) => releaseHold(h, 'lapsed')));
    return lapsed.length;
  }

  /**
   * Rules 40-41 — a voucher payment taken back, or the voucher part of a cancelled stay: the balance is re-credited by a
   * `refund`; on an expired voucher it is extended by 3 months from today, so the guest can use what came back.
   */
  function refund({ voucherId, amountCents, actor, reservationId, idempotencyKey, note }) {
    return transaction(() => {
      const voucher = vouchers.find(voucherId);
      const result = movements.append({
        voucherId, kind: 'refund', amountCents, actor, reservationId, note, idempotencyKey,
      });
      if (!result.replayed && voucher.expiresOn < today()) {
        const expiresOn = rules.addMonths(today(), REFUND_EXTENSION_MONTHS);
        vouchers.setExpiry(voucherId, expiresOn);
        movements.append({
          voucherId, kind: 'extend', amountCents: 0, actor, reservationId, note: expiresOn, idempotencyKey: `${idempotencyKey}:extend`,
        });
      }
      return result;
    });
  }

  /** The voucher a redeem movement was written on. */
  const redeemed = (movementId) => db.prepare("SELECT * FROM gift_voucher_movements WHERE id = ? AND kind = 'redeem'").get(Number(movementId)) || null;

  return {
    apply, held, release, releaseHoldsOf, settle, releaseLapsed, refund, redeemed, judgeCode, kindRefusal, today, openHolds, holdForUse, releaseUse, settleUse, useHeldCents,
  };
}

module.exports = {
  createRedemption, SOURCE, LABEL, REFUND_EXTENSION_MONTHS, HOLD_LIFETIME_MS, MESSAGES,
};
