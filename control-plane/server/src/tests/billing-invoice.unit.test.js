// specs/control-plane-plans-and-access.md rules 7, 17 and 32 — the renewal invoice: created in Qonto
// on the day the customer enters its `due` window, at the customer's catalogue price, once per
// period, retried until it succeeds, never without a working connection.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeFakeQonto, licencePayload, NEW_CUSTOMER } = require('./helpers');
const { euros } = require('../utils/money');

const MONTHLY = { ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' }; // ends 2026-11-01

async function setup(customer = MONTHLY, { ready = true, at = '2026-10-01T08:00:00Z' } = {}) {
  const qonto = makeFakeQonto({ ready });
  const h = makeContext({ at, qonto });
  const c = await h.ctx.controllers.customers.create(customer, 'op');
  const run = async (iso) => { h.now.set(iso); await h.ctx.controllers.billing.runDaily(() => {}); return h.ctx.controllers.customers.view(c.id); };
  return { ...h, qonto, c, run };
}

test('rule 17 — a monthly customer is invoiced 7 days before the end, with its link in the licence', async () => {
  const s = await setup();
  try {
    let view = await s.run('2026-10-24T08:00:00Z');
    assert.equal(view.invoices.length, 0, 'D-8: nothing yet');

    view = await s.run('2026-10-25T08:00:00Z');
    const [inv] = view.invoices;
    assert.equal(view.billing, 'monthly', 'the billing identity never shadows the billing mode');
    assert.equal(view.billingIdentity.lines[0].value, '4 route des Aulnes, 07140 Les Vans, France');
    assert.equal(inv.status, 'open');
    assert.equal(inv.number, 'F-2026-0002');
    assert.equal(inv.period, '01/11/2026 → 01/12/2026');
    assert.equal(inv.total, euros(7080));
    assert.equal(inv.payUrl, 'https://pay.test/links/pl_3');

    const [{ args: created }] = s.qonto.named('createInvoice');
    assert.deepEqual(created.items, [{ title: 'GuestFlow Pro — 1 mois', description: 'Du 01/11/2026 au 01/12/2026', amountCents: 5900, vatRate: 20 }]);
    assert.equal(created.expectedTotalCents, 7080);
    assert.equal(created.performanceStart, '2026-11-01');
    assert.equal(created.performanceEnd, '2026-12-01');
    assert.equal(created.dueDate, '2026-11-01');
    assert.equal(created.iban, s.qonto.state.iban);
    const { idempotencyKey, ...link } = s.qonto.named('createLink')[0].args;
    assert.deepEqual(link, { invoiceId: 'inv_2', invoiceNumber: 'F-2026-0002', debitorName: 'Gîte des Aulnes', amountCents: 7080 });
    assert.match(idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/, 'derived from the local invoice, so a lost answer is replayed, not duplicated');
    assert.match(created.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(created.idempotencyKey, idempotencyKey);

    const licence = licencePayload(s.ctx.controllers.customers.licenceDownload(s.c.id).token);
    assert.equal(licence.payUrl, 'https://pay.test/links/pl_3', 'the instance’s « Renouveler » opens the link');
    assert.ok(view.history.some((h) => h.text.startsWith(`Facture F-2026-0002 créée dans Qonto (1 mois, ${euros(5900)} HT, ${euros(7080)} TTC)`)));
  } finally {
    s.cleanup();
  }
});

test('rules 6, 17 — yearly: 30 days before, one line per add-on, at the price the customer was sold under', async () => {
  const s = await setup({ ...NEW_CUSTOMER, planCode: 'pro', billing: 'yearly', length: 12, startsAt: '2026-10-01', addons: ['neat'] });
  try {
    await s.ctx.controllers.catalogue.save({ ...s.ctx.controllers.catalogue.view(), plans: s.ctx.controllers.catalogue.view().plans.map((p) => ({ ...p, priceYearlyCents: p.priceYearlyCents + 1000 })), reason: 'hausse' }, 'op');
    assert.equal((await s.run('2027-08-31T08:00:00Z')).invoices.length, 0, 'D-31');
    const view = await s.run('2027-09-01T08:00:00Z');
    assert.equal(view.invoices[0].period, '01/10/2027 → 01/10/2028');
    const { items, expectedTotalCents } = s.qonto.named('createInvoice')[0].args;
    assert.deepEqual(items.map((i) => [i.title, i.amountCents]), [
      ['GuestFlow Pro — 12 mois', 4900 * 12],
      ['Option Assurance annulation Neat — 12 mois', 900 * 12],
    ]);
    assert.equal(expectedTotalCents, (4900 + 900) * 12 * 1.2);
  } finally {
    s.cleanup();
  }
});

test('rule 17 — a trial customer’s first invoice comes 7 days before the trial ends', async () => {
  const s = await setup({ ...MONTHLY, trial: true }); // trial until 2026-10-31
  try {
    assert.equal((await s.run('2026-10-23T08:00:00Z')).invoices.length, 0);
    const view = await s.run('2026-10-24T08:00:00Z');
    assert.equal(view.state, 'trial');
    assert.equal(view.invoices[0].period, '31/10/2026 → 30/11/2026');
  } finally {
    s.cleanup();
  }
});

test('rule 17 — one invoice per period; the Qonto client is created once per customer', async () => {
  const s = await setup();
  try {
    await s.run('2026-10-25T08:00:00Z');
    await s.run('2026-10-25T16:00:00Z');
    await s.run('2026-10-26T08:00:00Z');
    assert.equal(s.qonto.named('createInvoice').length, 1);
    s.qonto.pay('pl_3');
    await s.ctx.controllers.billing.checkPayments(() => {});
    const view = await s.run('2026-11-24T08:00:00Z');
    assert.equal(view.invoices.filter((i) => i.provider === 'qonto').length, 2);
    assert.equal(s.qonto.named('createClient').length, 1);
    assert.equal(s.qonto.named('createInvoice')[1].args.clientId, 'cl_1');
  } finally {
    s.cleanup();
  }
});

test('rules 7, 17, 18 — a failed invoice stays pending, alerted, and resumes where it stopped', async () => {
  const s = await setup();
  try {
    s.ctx.db.prepare("UPDATE customers SET billingStreet = '' WHERE id = ?").run(s.c.id);
    let view = await s.run('2026-10-25T08:00:00Z');
    assert.equal(view.invoices[0].status, 'pending');
    assert.equal(view.invoices[0].detail, 'Adresse de facturation manquante : complétez la fiche du client.');
    assert.ok(s.ctx.controllers.alerts.list().alerts.some((a) => a.text === 'Facture non créée pour Gîte des Aulnes : Adresse de facturation manquante : complétez la fiche du client.'));
    assert.equal(s.qonto.calls.length, 0);

    assert.throws(() => s.ctx.controllers.customers.setBilling(s.c.id, { billingStreet: '4 route', billingPostcode: '7140', billingCity: 'Les Vans' }, 'op'), /Code postal français : 5 chiffres/);
    s.ctx.controllers.customers.setBilling(s.c.id, { billingStreet: '4 route des Aulnes', billingPostcode: '07140', billingCity: 'Les Vans' }, 'op');
    s.qonto.state.failNext = { step: 'createLink', error: new Error('Qonto indisponible') };
    view = await s.run('2026-10-26T08:00:00Z');
    assert.equal(view.invoices[0].status, 'pending');
    assert.equal(view.invoices[0].detail, 'Qonto indisponible');
    assert.equal(view.invoices[0].number, 'F-2026-0002', 'the Qonto invoice was kept');

    view = await s.run('2026-10-27T08:00:00Z');
    assert.equal(view.invoices[0].status, 'open');
    assert.equal(view.invoices.length, 1);
    assert.equal(s.qonto.named('createInvoice').length, 1, 'never a second invoice for the same period');
    assert.equal(s.qonto.named('createLink').length, 2);
    assert.ok(!s.ctx.controllers.alerts.list().alerts.some((a) => /Facture non créée/.test(a.text)));
  } finally {
    s.cleanup();
  }
});

test('rule 17 — a total Qonto computes differently cancels that invoice and holds it until the operator retries', async () => {
  const s = await setup();
  try {
    const mismatch = Object.assign(new Error('mismatch'), { body: { code: 'AMOUNT_MISMATCH', invoiceId: 'inv_x', charged: 7081, expected: 7080 } });
    s.qonto.state.invoices.inv_x = { status: 'unpaid' };
    s.qonto.state.failNext = { step: 'createInvoice', error: mismatch };
    let view = await s.run('2026-10-25T08:00:00Z');
    assert.deepEqual(s.qonto.named('cancelInvoice').map((c) => c.args), ['inv_x']);
    assert.match(view.invoices[0].detail, /^Montant Qonto 70,81\s€ au lieu de 70,80\s€ : facture bloquée\./);
    assert.equal(view.actions.retryInvoice, true);
    assert.ok(view.history.some((h) => h.text === 'Facture Qonto au mauvais montant annulée dans Qonto (inv_x)'));

    view = await s.run('2026-10-26T08:00:00Z');
    view = await s.run('2026-10-27T08:00:00Z');
    assert.equal(s.qonto.named('createInvoice').length, 1, 'held: no invoice numbered and cancelled at every run');
    assert.equal(s.ctx.controllers.alerts.list().alerts.find((a) => /Facture non créée/.test(a.text)).severity, 'error');

    const first = s.qonto.named('createInvoice')[0].args.idempotencyKey;
    view = await s.ctx.controllers.billing.retryInvoice(s.c.id, 'adrien');
    assert.equal(view.invoices[0].status, 'open');
    assert.match(view.notice, /^Facture F-2026-\d{4} créée\.$/);
    assert.notEqual(s.qonto.named('createInvoice')[1].args.idempotencyKey, first, 'a retry is a new attempt');
  } finally {
    s.cleanup();
  }
});

test('rule 17 — a wrong invoice Qonto refuses to cancel is journaled, never swallowed', async () => {
  const s = await setup();
  try {
    const mismatch = Object.assign(new Error('mismatch'), { body: { code: 'AMOUNT_MISMATCH', invoiceId: 'inv_x', charged: 7081, expected: 7080 } });
    s.qonto.state.failNext = { step: 'createInvoice', error: mismatch };
    const cancel = s.qonto.cancelInvoice;
    s.qonto.cancelInvoice = async () => { throw new Error('Qonto 503'); };
    const view = await s.run('2026-10-25T08:00:00Z');
    s.qonto.cancelInvoice = cancel;
    assert.ok(view.history.some((h) => /^Facture Qonto au mauvais montant NON annulée \(inv_x\) : Qonto 503\. Annulez-la dans Qonto\.$/.test(h.text)));
  } finally {
    s.cleanup();
  }
});

test('rules 17, 19 — an extension never creates a second invoice; the reminders follow the new end date', async () => {
  const s = await setup();
  try {
    let view = await s.run('2026-10-25T08:00:00Z');
    view = s.ctx.controllers.customers.extend(s.c.id, { endsAt: '2026-11-16', reason: 'Panne', expectedEndsAt: view.endsAt }, 'adrien');
    for (const day of ['2026-11-01', '2026-11-08', '2026-11-09', '2026-11-16']) view = await s.run(`${day}T08:00:00Z`);
    assert.equal(s.qonto.named('createInvoice').length, 1, 'one unsettled invoice at a time');
    assert.deepEqual(view.emails.map((e) => e.name).reverse(), ['Facture', 'Relance jour J'],
      'D-7 of the old date was sent; D+7 of the old date is not a reminder any more, D of the new one is');
    assert.match(view.emails[0].at, /^16\/11\/2026/, 'prepared on the new deadline');

    s.qonto.pay('pl_3');
    await s.ctx.controllers.billing.checkPayments(() => {});
    view = s.ctx.controllers.customers.view(s.c.id);
    assert.equal(view.endsAt, '2026-12-16', 'the period paid is added to the extended date');
    view = await s.run('2026-12-09T08:00:00Z');
    assert.equal(view.invoices[0].period, '16/12/2026 → 16/01/2027', 'the next invoice starts where the last one ended');
    assert.equal(view.invoices.filter((i) => i.status === 'open').length, 1);
  } finally {
    s.cleanup();
  }
});

test('rules 18, 32 — without a working Qonto connection nothing is invoiced, and the home page says so', async () => {
  const s = await setup(MONTHLY, { ready: false });
  try {
    const view = await s.run('2026-10-25T08:00:00Z');
    assert.equal(view.invoices.length, 0);
    assert.equal(s.qonto.calls.length, 0);
    const alert = s.ctx.controllers.alerts.list().alerts.find((a) => a.link === '/parametres/paiements');
    assert.equal(alert.text, 'Qonto n’est pas connecté : aucune facture de renouvellement ne part. Réglages → Paiements.');
  } finally {
    s.cleanup();
  }
});
