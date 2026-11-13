/**
 * STEP payment (external) — what the document still asks once the money received is counted (specs/pricing-components.md §3 rules 21, 52).
 *
 * SETTLEMENT's `settleDocument` over the document's lines and its allocations: each line's status, the total, what was paid and what is left
 * (`remainingCents`). The step decides nothing itself, and a draft with no allocation simply owes its total.
 */
const { settleDocument } = require('../settlement');
const { owedOnDocument } = require('../refunds/owed');

const step = {
  id: 'externalPayment',
  requires: ['lines', 'allocations'],
  provides: ['settlement'],
  apply(ctx) {
    const lines = ctx.lines.map((line, index) => ({ ...line, ref: line.ref || `draft:${index}` }));
    const settled = settleDocument({ lines, allocations: ctx.allocations });
    const { owedCents } = owedOnDocument({ dueCents: settled.totalCents, paidCents: settled.paidCents + settled.refundedCents, refundedCents: settled.refundedCents });
    return { ...ctx, settlement: { ...settled, refundOwedCents: owedCents } };
  },
};

module.exports = step;
