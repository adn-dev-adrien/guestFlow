/**
 * What a plugin tells the payment poller about a basket it sold or could not honour (specs/pricing-components.md §3 rules 72, 75; SDK 2.29.0).
 * The figures of a refund live in `refunds/` only, so a plugin never writes `refundOwed`, a refund part or an overpayment itself: it asks here.
 *
 *   notHonoured(reason)            the whole payment is owed back — the order could no longer be honoured (origin `orderConflict`)
 *   partlyOwed(effect, owedCents, reason)   the sale was honoured and the payment was more than it cost: the gap is owed back
 *   overpaidBy(paidCents, soldCents)         what a payment brought beyond what the sale cost, in cents (never below 0)
 *
 * Pure: no DB, no clock.
 */
const ORIGIN = 'orderConflict';

const notHonoured = (reason) => ({ refundOwed: true, origin: ORIGIN, reason });

const partlyOwed = (effect, owedCents, reason) => ({
  effect, refundOwed: true, origin: ORIGIN, refundCents: Number(owedCents), reason,
});

const overpaidBy = (paidCents, soldCents) => Math.max(0, Number(paidCents || 0) - Number(soldCents || 0));

module.exports = { notHonoured, partlyOwed, overpaidBy };
