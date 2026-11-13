/**
 * REFUNDS / owed — the money that must LEAVE and has not yet (specs/pricing-components.md §3 rules 72 and 75, owner O-2, O-10).
 *
 * Three questions, one answer each, in cents. The callers write what they get into `refund_obligations`; nothing here reads a
 * database, a clock or a plugin.
 *
 *   owedOnBasket       a basket link paid by card whose plugin could not honour it: the whole payment, or the part its owner flagged
 *   owedOnLinkPayment  a link paid above what the stay asked: the excess and the duplicate part
 *   owedOnDuplicate    a link paid a second time: what the second payment gives back
 *   owedOnLineLowered  a paid line lowered, offered or removed: its trop-perçu share (rule 76), net of what is already owed for it
 *   owedOnDocument     a sale document paid above what its lines now ask (a line offered, removed, a link paid late): the excess, net of what was given back
 */

const whole = (value) => (Number.isInteger(value) ? value : 0);

/**
 * @param {{ paidCents: number, refundCents?: number, honoured?: boolean, reason?: string }} args
 *   `refundCents`: the part the owner flagged (strictly between 0 and the payment), else the whole payment is owed
 * @returns {{ owedCents: number, reason: string }}
 */
function owedOnBasket({ paidCents, refundCents = null, honoured = false, reason = '' }) {
  const paid = whole(paidCents);
  if (honoured || paid <= 0) return { owedCents: 0, reason: '' };
  const part = Number.isInteger(refundCents) && refundCents > 0 && refundCents < paid ? refundCents : null;
  return { owedCents: part || paid, reason: String(reason || 'achat non honoré') };
}

/**
 * @param {{ paidCents: number, expectedCents: (number|null), duplicateCents?: number }} args
 * @returns {{ excessCents: number, duplicateCents: number }}
 */
function owedOnLinkPayment({ paidCents, expectedCents, duplicateCents = 0 }) {
  const excess = expectedCents == null ? 0 : Math.max(0, whole(paidCents) - whole(expectedCents));
  return { excessCents: excess, duplicateCents: Math.max(0, whole(duplicateCents)) };
}

/**
 * A payment received a second time: what the second payment gives back — the whole link, unless the caller measured the part
 * that is a duplicate.
 * @param {{ paidCents: number, duplicateCents?: (number|null) }} args
 * @returns {{ owedCents: number }}
 */
function owedOnDuplicate({ paidCents, duplicateCents = null }) {
  return { owedCents: whole(duplicateCents == null ? paidCents : duplicateCents) };
}

/**
 * @param {{ overpaymentCents: number, alreadyOwedCents?: number }} args  the stay's trop-perçu after the change, and what the
 *   register already holds open for lowered lines
 * @returns {{ owedCents: number }} the obligation to open (0 when the register already covers it)
 */
function owedOnLineLowered({ overpaymentCents, alreadyOwedCents = 0 }) {
  return { owedCents: Math.max(0, whole(overpaymentCents) - whole(alreadyOwedCents)) };
}

/**
 * @param {{ dueCents: number, paidCents: number, refundedCents?: number }} args  what the document's lines ask now, what it received,
 *   what was already given back (all in cents)
 * @returns {{ owedCents: number }}
 */
function owedOnDocument({ dueCents, paidCents, refundedCents = 0 }) {
  return { owedCents: Math.max(0, whole(paidCents) - whole(refundedCents) - whole(dueCents)) };
}

/**
 * The part of a second paid link to give back, as the poll and the notifier carry it: `null` when the whole link is owed.
 * @param {(number|null)} [duplicateCents]
 */
const duplicatePayment = (duplicateCents = null) => ({ duplicateCents });

/**
 * The effect a poll reports when a link is paid a second time: the keys the alert, the register and the notifier read.
 * @param {(number|null)} duplicateCents  the part owed (`null`: the whole link)
 * @param {object} [extra]  `{ reservationId, conflict }` where the caller names them
 */
const doublePaymentEffect = (duplicateCents, extra = {}) => ({ effect: 'double-payment', duplicateLink: true, ...duplicatePayment(duplicateCents), ...extra });

/** What an acompte link paid, then the full link, leaves to give back: the acompte part only, the rest is the solde. */
const fullOverDeposit = ({ depositCents, linkCents }) => Math.min(Number(depositCents || 0), Number(linkCents || 0));

/** What a full link brought beyond the solde still owed (rule 41). */
const duplicateOnSolde = ({ linkCents, balanceCents }) => Math.max(0, linkCents - balanceCents);

/** A basket link its plugin could not honour: the basket flagged « à rembourser », the part flagged when it is only a part. */
const flagRefundOwed = (basket, partCents) => ({ ...basket, refundOwed: true, ...(partCents ? { refundCents: partCents } : {}) });

module.exports = {
  owedOnBasket, owedOnLinkPayment, owedOnDuplicate, owedOnLineLowered, owedOnDocument, duplicatePayment, doublePaymentEffect, fullOverDeposit, duplicateOnSolde, flagRefundOwed,
};
