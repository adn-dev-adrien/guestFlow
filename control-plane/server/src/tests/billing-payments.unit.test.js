// specs/control-plane-plans-and-access.md rules 15, 19 and 34 — a payment detected in Qonto renews
// once; a failed attempt is alerted once; a payment recorded by hand closes the open invoice and
// deactivates its link; deprovisioning cancels; a plan change keeps the invoice already issued.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeFakeQonto, NEW_CUSTOMER } = require('./helpers');

const MONTHLY = { ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' }; // ends 2026-11-01

async function invoiced() {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  const c = await h.ctx.controllers.customers.create(MONTHLY, 'op');
  h.now.set('2026-10-25T08:00:00Z');
  await h.ctx.controllers.billing.runDaily(() => {});
  const view = () => h.ctx.controllers.customers.view(c.id);
  return { ...h, qonto, c, view, billing: h.ctx.controllers.billing };
}

test('rules 15, 34 — a paid link renews by the invoiced length, once, whatever reports it', async () => {
  const s = await invoiced();
  try {
    assert.equal(await s.billing.checkPayments(() => {}), 0);
    s.qonto.pay('pl_3');
    s.now.set('2026-10-26T09:10:00Z');
    assert.equal(await s.billing.checkPayments(() => {}), 1);
    let v = s.view();
    assert.equal(v.endsAt, '2026-12-01');
    assert.equal(v.state, 'active');
    assert.equal(v.invoices[0].statusLabel, 'Payée');
    assert.equal(v.invoices[0].payUrl, null);
    assert.equal(await s.billing.checkPayments(() => {}), 0);
    await s.billing.onLinkEvent('pl_3');
    v = s.view();
    assert.equal(v.endsAt, '2026-12-01', 'the webhook after the poll changes nothing');
    assert.equal(v.history.filter((h) => /^Facture F-2026-0002 payée \(Qonto\)/.test(h.text)).length, 1);
  } finally {
    s.cleanup();
  }
});

test('rule 34 — an invoice marked paid in Qonto (a matched transfer) renews too', async () => {
  const s = await invoiced();
  try {
    s.qonto.payInvoice('inv_2');
    await s.billing.checkCustomer(s.c.id, 'adrien').then((v) => assert.equal(v.notice, 'Paiement reçu : facture F-2026-0002 payée, abonnement renouvelé.'));
    assert.equal(s.view().endsAt, '2026-12-01');
  } finally {
    s.cleanup();
  }
});

test('rules 18, 34 — a failed attempt is journaled and alerted once', async () => {
  const s = await invoiced();
  try {
    s.qonto.fail('pl_3', 'tr_1');
    await s.billing.checkPayments(() => {});
    await s.billing.checkPayments(() => {});
    const alerts = s.ctx.controllers.alerts.list().alerts.filter((a) => /Paiement échoué/.test(a.text));
    assert.deepEqual(alerts.map((a) => a.text), ['Paiement échoué sur la facture F-2026-0002 de Gîte des Aulnes (paiement refusé), le 25/10/2026.']);
    assert.equal(s.view().history.filter((h) => h.text === 'Facture F-2026-0002 : paiement refusé').length, 1);
    s.now.set('2026-11-02T08:00:00Z');
    assert.equal(s.ctx.controllers.alerts.list().alerts.filter((a) => /Paiement échoué/.test(a.text)).length, 0, 'gone after 7 days');
  } finally {
    s.cleanup();
  }
});

test('rules 19, 34 — a payment recorded by hand closes the open invoice and deactivates its link', async () => {
  const s = await invoiced();
  try {
    const before = s.view();
    assert.equal(before.paymentPreview.length, 1);
    assert.match(before.paymentPreview[0].text, /^Solde la facture F-2026-0002 et désactive son lien de paiement/);
    const v = await s.billing.recordPayment(s.c.id, { months: 1, reference: 'virement 27/10', expectedEndsAt: before.endsAt }, 'adrien');
    assert.equal(v.invoices.length, 1, 'no second invoice');
    await assert.rejects(s.billing.recordPayment(s.c.id, { months: 1, expectedEndsAt: before.endsAt }, 'adrien'), (e) => e.body.error === 'STALE',
      'a double click finds the end date moved and records nothing');
    assert.equal(s.view().endsAt, '2026-12-01');
    assert.equal(v.invoices[0].detail.startsWith('Soldée à la main'), true);
    assert.equal(v.endsAt, '2026-12-01');
    assert.deepEqual(s.qonto.named('deactivateLink').map((c) => c.args), ['pl_3']);
    assert.equal(s.billing.queue().length, 0);
    assert.ok(v.history.some((h) => h.text === 'Référence du paiement de la facture F-2026-0002 : « virement 27/10 »'));
  } finally {
    s.cleanup();
  }
});

test('rule 34 — deprovisioning cancels the open invoice in Qonto and its waiting email', async () => {
  const s = await invoiced();
  try {
    const v = await s.billing.deprovision(s.c.id, { confirmSlug: 'aulnes' }, 'adrien');
    assert.ok(v.archivedAt);
    assert.equal(v.invoices[0].statusLabel, 'Annulée');
    assert.deepEqual(s.qonto.named('cancelInvoice').map((c) => c.args), ['inv_2']);
    assert.deepEqual(s.qonto.named('deactivateLink').map((c) => c.args), ['pl_3']);
    assert.equal(s.billing.queue().length, 0);
  } finally {
    s.cleanup();
  }
});

test('rule 34 — a plan change keeps the invoice as issued; the next one carries the new price', async () => {
  const s = await invoiced();
  try {
    const issued = s.view().invoices[0];
    s.ctx.controllers.customers.changePlan(s.c.id, { planCode: 'premium', billing: 'monthly', addons: [] }, 'adrien');
    assert.deepEqual(s.view().invoices[0], issued);
    assert.equal(s.qonto.named('createInvoice').length, 1);
    s.qonto.pay('pl_3');
    await s.billing.checkPayments(() => {});
    s.now.set('2026-11-24T08:00:00Z');
    await s.billing.runDaily(() => {});
    assert.deepEqual(s.qonto.named('createInvoice')[1].args.items.map((i) => [i.title, i.amountCents]), [['GuestFlow Premium — 1 mois', 9900]]);
  } finally {
    s.cleanup();
  }
});

test('rule 34 — a card payment that just landed wins over the payment recorded by hand', async () => {
  const s = await invoiced();
  try {
    s.qonto.pay('pl_3');
    const v = await s.billing.recordPayment(s.c.id, { months: 1, expectedEndsAt: s.view().endsAt }, 'adrien');
    assert.match(v.notice, /vient d’être payée en ligne/);
    assert.equal(v.endsAt, '2026-12-01');
    assert.equal(v.invoices.length, 1);
    assert.equal(v.invoices[0].detail.startsWith('Payée le'), true);
    assert.equal(s.qonto.named('deactivateLink').length, 0);
  } finally {
    s.cleanup();
  }
});

test('rule 34 — the link is deactivated before the invoice is settled by hand', async () => {
  const s = await invoiced();
  try {
    let settledWhenDeactivated = null;
    const deactivate = s.qonto.deactivateLink;
    s.qonto.deactivateLink = async (id) => { settledWhenDeactivated = s.view().invoices[0].status; return deactivate(id); };
    await s.billing.recordPayment(s.c.id, { months: 1, expectedEndsAt: s.view().endsAt }, 'adrien');
    assert.equal(settledWhenDeactivated, 'open');
  } finally {
    s.cleanup();
  }
});

test('rule 34 — an invoice still in preparation is settled by a payment recorded by hand, not orphaned', async () => {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  try {
    const c = await h.ctx.controllers.customers.create(MONTHLY, 'op');
    h.now.set('2026-10-25T08:00:00Z');
    qonto.state.failNext = { step: 'iban', error: new Error('Qonto 503') };
    await h.ctx.controllers.billing.runDaily(() => {});
    let v = h.ctx.controllers.customers.view(c.id);
    assert.equal(v.invoices[0].status, 'pending');
    assert.match(v.paymentPreview[0].text, /^Solde la facture en préparation ; rapprochez le virement dans Qonto\./);
    v = await h.ctx.controllers.billing.recordPayment(c.id, { months: 1, expectedEndsAt: v.endsAt }, 'adrien');
    assert.equal(v.invoices.length, 1);
    assert.equal(v.invoices[0].status, 'paid');
    assert.equal(v.endsAt, '2026-12-01');
    assert.equal(h.ctx.controllers.alerts.list().alerts.filter((a) => /Facture non créée/.test(a.text)).length, 0);
  } finally {
    h.cleanup();
  }
});

test('rule 17 — two clicks on « Envoyer » at once send one email', async () => {
  const s = await invoiced();
  try {
    const [row] = s.billing.queue();
    const results = await Promise.allSettled([s.billing.sendQueued(row.id, 'a'), s.billing.sendQueued(row.id, 'b')]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(s.mailer.sent.filter((m) => m.to === 'claire@aulnes.fr').length, 1);
  } finally {
    s.cleanup();
  }
});
