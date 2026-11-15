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
});

const failure = (status, errorCode, extra = {}) => ({
  ok: false, status, code: errorCode, message: MESSAGES[errorCode], ...extra,
});

const lastFour = (normalised) => normalised.slice(-4);

function createRedemption({
  db, vouchers, movements, checks, limits, pepper, ipOf, now = () => new Date(), transaction = (fn) => db.transaction(fn)(),
}) {
  const today = () => rules.parisDate(now());
  const visitorHashFor = (visitor) => visitorHashOf(pepper(), ipOf(visitor || {}));

  const holdsOf = (devisId) => db.prepare("SELECT * FROM gift_voucher_movements WHERE devisId = ? AND kind = 'hold' ORDER BY id").all(Number(devisId));
  const releaseKey = (hold) => `release:hold:${hold.id}`;
  const openHolds = (devisId) => holdsOf(devisId).filter((h) => !movements.byKey(releaseKey(h)));

  /** Rule 33 — what a typed code is worth, judged like the public check: limits first, then the code. */
  function judgeCode(input, visitor) {
    const visitorHash = visitorHashFor(visitor);
    const limited = limits.refusal(visitorHash);
    if (limited) return failure(429, limited.code, { retryAfterSeconds: limited.retryAfterSeconds });
    const normalised = code.normalise(typeof input.code === 'string' ? input.code.slice(0, 64) : '');
    if (!code.hasValidCheck(normalised)) {
      checks.record({ visitorHash, outcome: 'mistyped' });
      return failure(400, 'VOUCHER_CODE_MISTYPED');
    }
    const voucher = vouchers.findByCodeHash(code.hashCode(pepper(), normalised));
    if (!voucher || voucher.cancelledAt) {
      checks.record({ visitorHash, outcome: 'unknown' });
      return failure(404, 'VOUCHER_UNKNOWN', { triesLeft: limits.triesLeft(visitorHash) });
    }
    const state = rules.stateOf({ voucher, balanceCents: voucher.balanceCents, today: today() });
    checks.record({ visitorHash, outcome: rules.isUsable(state) ? 'usable' : state });
    if (state === 'expired') return failure(409, 'VOUCHER_EXPIRED', { expiresOn: voucher.expiresOn });
    if (state === 'exhausted') return failure(409, 'VOUCHER_EXHAUSTED');
    return { ok: true, voucher, normalised };
  }

  /**
   * `ctx.prepaid`'s `apply` (rule 36): the amount the code is worth on a quote, held for it unless `dryRun`. Never above
   * `capCents`, the stay's pre-arrival total. A hold lost to a concurrent one is answered with the balance left.
   */
  function apply({
    devisId, input, capCents, visitor, dryRun = false,
  }) {
    const judged = judgeCode(input, visitor);
    if (!judged.ok) return judged;
    const { voucher, normalised } = judged;
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

  /** Rule 37 — the holds a quote that never became a stay kept past their lifetime (a job). → how many were given back. */
  function releaseLapsed({ isConverted }) {
    const cutoff = new Date(now().getTime() - HOLD_LIFETIME_MS).toISOString();
    const lapsed = db.prepare("SELECT * FROM gift_voucher_movements WHERE kind = 'hold' AND createdAt < ? ORDER BY id").all(cutoff)
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
    apply, held, release, settle, releaseLapsed, refund, redeemed, judgeCode, today, openHolds,
  };
}

module.exports = {
  createRedemption, SOURCE, LABEL, REFUND_EXTENSION_MONTHS, HOLD_LIFETIME_MS, MESSAGES,
};
