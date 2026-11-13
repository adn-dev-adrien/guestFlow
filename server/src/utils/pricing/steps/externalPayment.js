/**
 * STEP payment (external) — what the document still asks once the money received is counted (specs/pricing-components.md §3 rules 21, 52).
 *
 * SETTLEMENT's `settleDocument` over the document's lines and its allocations: each line's status, the total, what was paid and what is left
 * (`remainingCents`). The step decides nothing itself, and a draft with no allocation simply owes its total. What REFUNDS owes back is read by the caller
 * (`utils/standaloneSale.js`): no pricing unit imports REFUNDS (rule 72).
 */
const { settleDocument } = require('../settlement');

const step = {
  id: 'externalPayment',
  requires: ['lines', 'allocations'],
  provides: ['settlement'],
  apply(ctx) {
    const lines = ctx.lines.map((line, index) => ({ ...line, ref: line.ref || `draft:${index}` }));
    const settled = settleDocument({ lines, allocations: ctx.allocations });
    return { ...ctx, settlement: settled };
  },
};

module.exports = step;
