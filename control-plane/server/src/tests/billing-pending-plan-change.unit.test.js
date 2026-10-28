// specs/control-plane-plans-and-access.md rule 40 (audit 2026-10-28, M1): a renewal invoice Qonto does not
// hold yet follows the customer's current plan, so a plan change cannot block it for good.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeFakeQonto, NEW_CUSTOMER } = require('./helpers');

const MONTHLY = { ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' };

// The real client's guard (server/src/utils/qonto/qontoClient.js): an invoice whose total is not the expected one is refused.
function guardedQonto() {
  const qonto = makeFakeQonto();
  const create = qonto.createInvoice;
  qonto.createInvoice = async (args) => {
    const inv = await create(args);
    if (args.expectedTotalCents != null && inv.totalCents !== args.expectedTotalCents) {
      throw Object.assign(new Error('mismatch'), { body: { code: 'AMOUNT_MISMATCH', invoiceId: inv.id, charged: inv.totalCents, expected: args.expectedTotalCents } });
    }
    return inv;
  };
  return qonto;
}

test('rule 40: a plan change while the renewal invoice is pending re-prices it and the next run succeeds', async () => {
  const qonto = guardedQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  try {
    const c = await h.ctx.controllers.customers.create(MONTHLY, 'op');
    qonto.state.failNext = { step: 'createInvoice', error: new Error('Qonto timeout') };
    h.now.set('2026-10-25T08:00:00Z');
    await h.ctx.controllers.billing.runDaily(() => {});
    const before = h.ctx.controllers.customers.view(c.id).invoices[0];
    assert.equal(before.status, 'pending');
    h.ctx.controllers.customers.changePlan(c.id, { planCode: 'premium', billing: 'monthly', addons: [] }, 'op');
    h.now.set('2026-10-26T08:00:00Z');
    await h.ctx.controllers.billing.runDaily(() => {});
    const view = h.ctx.controllers.customers.view(c.id);
    assert.equal(view.invoices.length, 1);
    assert.equal(view.invoices[0].status, 'open');
    assert.notEqual(view.invoices[0].total, before.total, 'priced on the new plan');
    assert.equal(qonto.named('createInvoice').length, 2, 'one failed attempt, one success');
    assert.equal(qonto.named('cancelInvoice').length, 0, 'no numbered invoice burned');
    assert.ok(h.ctx.models.audit.forCustomer(c.id).some((a) => /recalculée sur l’offre actuelle/.test(a.text)));
  } finally { h.cleanup(); }
});

test('rule 40: a held invoice (earlier mismatch) is re-priced by « Réessayer la facture »', async () => {
  const qonto = guardedQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  try {
    const c = await h.ctx.controllers.customers.create(MONTHLY, 'op');
    qonto.state.failNext = { step: 'createInvoice', error: new Error('Qonto timeout') };
    h.now.set('2026-10-25T08:00:00Z');
    await h.ctx.controllers.billing.runDaily(() => {});
    h.ctx.db.prepare('UPDATE invoices SET totalCents = totalCents + 100 WHERE customerId = ?').run(c.id);
    h.ctx.db.prepare('UPDATE invoices SET held = 1 WHERE customerId = ?').run(c.id);
    const result = await h.ctx.controllers.billing.retryInvoice(c.id, 'op');
    assert.match(result.notice, /^Facture .+ créée\.$/);
  } finally { h.cleanup(); }
});
