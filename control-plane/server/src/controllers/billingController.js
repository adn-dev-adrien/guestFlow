/**
 * The renewal (specs/control-plane-plans-and-access.md rules 15, 17, 18, 19, 33, 34): the Qonto
 * invoice of the next period, the emails of that invoice, the approval queue, « Relancer
 * maintenant », payment detection, and the operator's daily email.
 *
 * Qonto is reached only through `ctx.qonto` (utils/qontoBilling.js). The customer's state never
 * depends on it: the calendar drives the state, Qonto only moves the end date when it is paid.
 */

const crypto = require('crypto');
const { dueWindow, renewedEndsAt } = require('../utils/lifecycle');
const { parisDay, addDays, addMonths, frDay } = require('../utils/days');
const { KINDS, render } = require('../utils/templates');
const { httpError } = require('../utils/httpError');
const { euros } = require('../utils/money');

const VAT_RATE = 20;
const FAILURE_ALERT_DAYS = 7;
const FAILURE_LABELS = { failed: 'paiement refusé', expired: 'paiement expiré', canceled: 'paiement abandonné', cancelled: 'paiement abandonné' };

// Rule 17: the scheduled emails of an invoice, as days from its deadline D.
function scheduleOf(billing) {
  return [
    { kind: 'invoice', offset: -dueWindow(billing) },
    ...(billing === 'yearly' ? [{ kind: 'reminder_before', offset: -7 }] : []),
    { kind: 'reminder_due', offset: 0 },
    { kind: 'reminder_after', offset: 7 },
  ];
}

const withVat = (cents) => cents + Math.round((cents * VAT_RATE) / 100);

// The same call repeated after a lost answer carries the same key, so Qonto can return what it
// created instead of numbering a second invoice. Derived from local ids, shaped as a UUID.
function idempotencyKey(...parts) {
  const h = crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function createBillingController(ctx, customersController) {
  const { models, now, mailer, qonto } = ctx;
  const { customers, invoices, emails, operators } = models;
  const { journal, refresh, priceLines, urlOf } = customersController;

  const today = () => parisDay(now());
  const stamp = () => now().toISOString();

  function mustGet(id) {
    const c = customers.get(id);
    if (!c || c.erasedAt) throw httpError(404, 'NOT_FOUND', 'Client introuvable.');
    return c;
  }

  // --- the invoice of the next period (rule 17) ----------------------------------------------

  function invoiceDay(c) {
    return addDays(c.endsAt, -dueWindow(c.billing));
  }

  // `periodStart` is the invoice's own when it already exists: an extension (rule 19) moves the
  // customer's end date, never the period an invoice was issued for.
  function draftInvoice(c, periodStart = c.endsAt) {
    const months = c.billing === 'yearly' ? 12 : 1;
    const periodEnd = addMonths(periodStart, months);
    const lines = priceLines(c).map((l) => ({
      title: `${l.title} — ${months} mois`,
      description: `Du ${frDay(periodStart)} au ${frDay(periodEnd)}`,
      amountCents: l.monthlyCents * months,
      vatRate: VAT_RATE,
    }));
    return {
      months,
      periodEnd,
      lines,
      amountCents: lines.reduce((s, l) => s + l.amountCents, 0),
      totalCents: lines.reduce((s, l) => s + withVat(l.amountCents), 0),
    };
  }

  const coded = (code, message) => Object.assign(new Error(message), { code });

  function errorText(err) {
    if (err.code === 'QONTO_NOT_CONNECTED' || err.code === 'QONTO_NOT_CONFIGURED') return 'Qonto n’est pas connecté (Réglages → Paiements).';
    if (err.body && err.body.code === 'AMOUNT_MISMATCH') return `Qonto a calculé ${euros(err.body.charged)} au lieu de ${euros(err.body.expected)} : facture bloquée, à vérifier puis « Réessayer la facture ».`;
    return err.message || 'Erreur Qonto.';
  }

  // Takes a `pending` invoice as far as it can: Qonto client, invoice, link. Each step is saved as
  // soon as it succeeds, so a retry resumes where the last attempt stopped.
  async function complete(c, inv) {
    try {
      if (!c.billingStreet || !c.billingPostcode || !c.billingCity) {
        throw coded('NO_ADDRESS', 'Adresse de facturation manquante : complétez la fiche du client.');
      }
      let clientId = c.qontoClientId;
      if (!clientId) {
        const created = await qonto.createClient({
          name: c.companyName, email: c.contactEmail, street: c.billingStreet, postcode: c.billingPostcode,
          city: c.billingCity, countryCode: c.billingCountry, vatNumber: c.vatNumber || undefined,
          idempotencyKey: idempotencyKey('client', c.id, c.companyName, c.billingStreet, c.billingPostcode, c.billingCity, c.billingCountry, c.vatNumber),
        });
        clientId = created.id;
        customers.setQontoClientId(c.id, clientId);
      }
      let current = inv;
      if (!current.providerRef) {
        const draft = draftInvoice(c, current.periodStart);
        const iban = await qonto.iban();
        let created;
        try {
          created = await qonto.createInvoice({
            clientId, issueDate: today(), dueDate: current.periodStart > today() ? current.periodStart : today(),
            performanceStart: current.periodStart, performanceEnd: current.periodEnd,
            items: draft.lines, iban, expectedTotalCents: current.totalCents,
            idempotencyKey: idempotencyKey('invoice', current.id, current.attempt),
          });
        } catch (err) {
          // A wrong amount is not retried at every run: each retry would number and cancel one more
          // invoice. The row is held until the operator retries it.
          if (err.body && err.body.code === 'AMOUNT_MISMATCH') {
            invoices.update(current.id, { held: 1 });
            if (err.body.invoiceId) await cancelWrongInvoice(c, err.body.invoiceId);
          }
          throw err;
        }
        invoices.update(current.id, { providerRef: created.id, number: created.number, invoiceUrl: created.invoiceUrl });
        current = invoices.get(current.id);
      }
      if (!current.payLinkId) {
        const link = await qonto.createLink({
          invoiceId: current.providerRef, invoiceNumber: current.number, debitorName: c.companyName, amountCents: current.totalCents,
          idempotencyKey: idempotencyKey('link', current.id, current.attempt),
        });
        invoices.update(current.id, { payLinkId: link.id, payUrl: link.url, status: 'open', lastError: null });
        journal(c.id, 'système', 'invoice', `Facture ${current.number} créée dans Qonto (${current.months} mois, ${euros(current.amountCents)} HT, ${euros(current.totalCents)} TTC) avec son lien de paiement`);
        refresh(c.id);
      }
    } catch (err) {
      const text = errorText(err);
      const before = invoices.get(inv.id).lastError;
      invoices.update(inv.id, { lastError: text });
      if (before !== text) journal(c.id, 'système', 'invoice', `Facture non créée : ${text}`);
    }
    return invoices.get(inv.id);
  }

  async function cancelWrongInvoice(c, qontoInvoiceId) {
    try {
      await qonto.cancelInvoice(qontoInvoiceId);
      journal(c.id, 'système', 'invoice', `Facture Qonto au mauvais montant annulée dans Qonto (${qontoInvoiceId})`);
    } catch (err) {
      journal(c.id, 'système', 'invoice', `Facture Qonto au mauvais montant NON annulée (${qontoInvoiceId}) : ${errorText(err)}. Annulez-la dans Qonto.`);
    }
  }

  // One unsettled invoice per customer at a time: until it is paid or cancelled, no other is
  // created, even when an extension (rule 19) moved the end date past its period.
  async function ensureInvoice(c) {
    if (c.archivedAt) return null;
    const unsettled = invoices.unsettled(c.id)[0];
    if (unsettled) {
      if (unsettled.status !== 'pending' || unsettled.held || !qonto.ready()) return unsettled;
      return complete(customers.get(c.id), unsettled);
    }
    if (today() < invoiceDay(c)) return null;
    const existing = invoices.forPeriod(c.id, c.endsAt);
    if (existing) return existing;
    if (!qonto.ready()) return null;
    const draft = draftInvoice(c);
    const id = invoices.insert({
      customerId: c.id, periodStart: c.endsAt, periodEnd: draft.periodEnd, months: draft.months,
      amountCents: draft.amountCents, totalCents: draft.totalCents, provider: 'qonto', status: 'pending', createdAt: stamp(),
    });
    return complete(customers.get(c.id), invoices.get(id));
  }

  // « Réessayer la facture »: a held invoice is tried again, as a new attempt.
  async function retryInvoice(id, operator) {
    const c = mustGet(id);
    const inv = invoices.unsettled(c.id).find((i) => i.status === 'pending');
    if (c.archivedAt || !inv) throw httpError(409, 'NO_PENDING_INVOICE', 'Aucune facture en préparation à réessayer.');
    if (!qonto.ready()) throw httpError(409, 'QONTO_NOT_READY', 'Qonto n’est pas connecté (Réglages → Paiements).');
    invoices.update(inv.id, { held: 0, attempt: inv.attempt + 1, lastError: null });
    journal(c.id, operator, 'invoice', 'Création de la facture relancée à la main');
    const after = await complete(customers.get(c.id), invoices.get(inv.id));
    const view = customersController.view(c.id);
    return { ...view, notice: after.status === 'open' ? `Facture ${after.number} créée.` : `Facture toujours non créée : ${after.lastError}` };
  }

  // --- the emails of an invoice (rules 17, 33) ------------------------------------------------

  // The deadline is the customer's end date: an extension (rule 19) moves it, and the reminders with it.
  function varsFor(c, inv) {
    return {
      contactName: c.contactName || c.companyName,
      companyName: c.companyName,
      planName: models.catalogue.plan(c.planCode).name,
      period: `${frDay(inv.periodStart)} → ${frDay(inv.periodEnd)}`,
      amount: euros(inv.totalCents),
      deadline: frDay(c.endsAt),
      invoiceNumber: inv.number || '',
      invoiceUrl: inv.invoiceUrl || '',
      payUrl: inv.payUrl || '',
      spaceUrl: urlOf(c.slug),
    };
  }

  function compose(c, inv, kind) {
    const t = emails.template(kind);
    const vars = varsFor(c, inv);
    return { recipient: c.contactEmail, subject: render(t.subject, vars), body: render(t.body, vars) };
  }

  // A template counts as « Automatique » only when it says so and can be read; anything else is
  // « Manuel » (rule 33: fail closed).
  function autoSends(kind) {
    try {
      return emails.template(kind).sendMode === 'auto';
    } catch {
      return false;
    }
  }

  // The row is claimed before the email leaves: of two clicks at once, only one sends. → true sent,
  // false failed, null when someone else had already handled it.
  async function deliver(row, operator) {
    if (!emails.handle({ id: row.id, status: 'sent', at: stamp(), operator })) return null;
    try {
      await mailer.send({ to: row.recipient, subject: row.subject, text: row.body });
      emails.finish({ id: row.id, status: 'sent', at: stamp(), operator });
      journal(row.customerId, operator, 'email', `Email « ${KINDS[row.kind].name} » envoyé à ${row.recipient}`);
      return true;
    } catch (err) {
      emails.finish({ id: row.id, status: 'failed', at: stamp(), operator, error: err.message });
      journal(row.customerId, operator, 'email', `Email « ${KINDS[row.kind].name} » : échec de l’envoi (${err.message})`);
      return false;
    }
  }

  function drop(invoiceId, why) {
    for (const row of emails.pendingOfInvoice(invoiceId)) {
      if (emails.handle({ id: row.id, status: 'dropped', at: stamp(), error: why })) {
        journal(row.customerId, 'système', 'email', `Email « ${KINDS[row.kind].name} » retiré de la file sans être envoyé : ${why}`);
      }
    }
  }

  // Only the latest email whose day has come, and only once (rule 17).
  async function runEmails(c) {
    for (const inv of invoices.unsettled(c.id).filter((i) => i.status === 'open')) {
      const due = scheduleOf(c.billing).filter((s) => addDays(c.endsAt, s.offset) <= today());
      const latest = due[due.length - 1];
      if (!latest || emails.exists(inv.id, latest.kind)) continue;
      drop(inv.id, `remplacé par « ${KINDS[latest.kind].name} »`);
      const auto = autoSends(latest.kind);
      const id = emails.insert({
        customerId: c.id, invoiceId: inv.id, kind: latest.kind, status: 'pending', ...compose(c, inv, latest.kind), preparedAt: stamp(),
      });
      if (auto) await deliver(emails.get(id), 'système');
      else journal(c.id, 'système', 'email', `Email « ${KINDS[latest.kind].name} » préparé : en attente de validation`);
    }
  }

  function queue() {
    return emails.pending().map((e) => {
      const c = customers.get(e.customerId);
      return {
        id: e.id,
        customerId: e.customerId,
        companyName: c ? c.companyName : '',
        name: KINDS[e.kind].name,
        preparedOn: frDay(parisDay(new Date(e.preparedAt))),
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
      };
    });
  }

  async function sendQueued(id, operator) {
    const row = emails.get(id);
    if (!row || (await deliver(row, operator)) === null) throw httpError(409, 'NOT_PENDING', 'Cet email n’est plus en attente.');
    return { queue: queue() };
  }

  function ignoreQueued(id, operator) {
    const row = emails.get(id);
    if (!row || !emails.handle({ id: row.id, status: 'ignored', at: stamp(), operator })) {
      throw httpError(409, 'NOT_PENDING', 'Cet email n’est plus en attente.');
    }
    journal(row.customerId, operator, 'email', `Email « ${KINDS[row.kind].name} » ignoré`);
    return { queue: queue() };
  }

  // « Relancer maintenant »: the click is the approval (rule 17).
  async function remind(id, body, operator) {
    const c = mustGet(id);
    const inv = invoices.unsettled(c.id).find((i) => i.status === 'open');
    if (c.archivedAt || !inv) throw httpError(409, 'NO_OPEN_INVOICE', 'Aucune facture ouverte à relancer.');
    const mail = compose(c, inv, 'reminder_manual');
    if (body && body.preview) return { preview: { to: mail.recipient, subject: mail.subject, body: mail.body } };
    const rowId = emails.insert({ customerId: c.id, invoiceId: inv.id, kind: 'reminder_manual', status: 'pending', ...mail, preparedAt: stamp() });
    await deliver(emails.get(rowId), operator);
    return customersController.view(c.id);
  }

  // --- payments (rules 15, 19, 34) -------------------------------------------------------------

  function settle(inv, { paidBy, paidAt, operator }) {
    if (!invoices.markPaid({ id: inv.id, paidAt, paidBy })) return false;
    const c = customers.get(inv.customerId);
    const endsAt = renewedEndsAt(c.endsAt, inv.months, today());
    customers.setEndsAt(c.id, endsAt);
    customers.setForceActiveUntil(c.id, null);
    drop(inv.id, 'la facture est payée');
    journal(c.id, operator, 'payment', `Facture ${inv.number || '(en préparation)'} ${paidBy === 'qonto' ? 'payée (Qonto)' : 'soldée à la main'} : ${euros(inv.amountCents)} HT, échéance au ${frDay(endsAt)}`);
    refresh(c.id, operator);
    return true;
  }

  async function checkInvoice(inv, operator = 'système') {
    if (inv.status !== 'open') return false;
    let paidAt = null;
    if (inv.payLinkId) {
      const link = await qonto.linkPayments(inv.payLinkId);
      for (const f of link.failures) {
        if (invoices.recordFailure({ providerPaymentId: f.id, invoiceId: inv.id, status: f.status, at: stamp() })) {
          journal(inv.customerId, 'système', 'payment_failed', `Facture ${inv.number} : ${FAILURE_LABELS[f.status] || f.status}`);
        }
      }
      if (link.paid) paidAt = link.paidAt || stamp();
    }
    if (!paidAt && inv.providerRef) {
      const read = await qonto.readInvoice(inv.providerRef);
      if (read.status === 'paid') paidAt = read.paidAt || stamp();
    }
    return paidAt ? settle(inv, { paidBy: 'qonto', paidAt, operator }) : false;
  }

  // Every 15 minutes, and after a webhook: each open invoice, one failure never stopping the others.
  async function checkPayments(log = (msg) => console.log(msg)) {
    if (!qonto.ready()) return 0;
    let paid = 0;
    for (const inv of invoices.withStatus('open')) {
      try {
        if (await checkInvoice(inv)) paid += 1;
      } catch (err) {
        log(`[billing] payment check of invoice ${inv.id} failed: ${err.message}`);
      }
    }
    return paid;
  }

  async function checkCustomer(id, operator) {
    const c = mustGet(id);
    const open = invoices.unsettled(c.id).filter((i) => i.status === 'open');
    if (!open.length) throw httpError(409, 'NO_OPEN_INVOICE', 'Aucune facture ouverte.');
    let paid = false;
    try {
      for (const inv of open) paid = (await checkInvoice(inv, operator)) || paid;
    } catch (err) {
      throw httpError(502, 'QONTO_API_ERROR', `Qonto ne répond pas : ${errorText(err)}`);
    }
    const view = customersController.view(c.id);
    const number = open[0].number;
    return { ...view, notice: paid ? `Paiement reçu : facture ${number} payée, abonnement renouvelé.` : `Qonto : facture ${number} toujours à payer.` };
  }

  // The payment-link webhook: the event only says which link moved; Qonto is re-read before anything.
  async function onLinkEvent(payLinkId) {
    const inv = payLinkId ? invoices.byPayLink(payLinkId) : null;
    if (inv && inv.status === 'open') await checkInvoice(inv);
  }

  // Rule 34: a payment recorded by hand closes the unsettled invoice (issued or still in
  // preparation) instead of adding another. Its link is read first — a card payment may have just
  // landed — then deactivated, and only then is the invoice settled, so the customer cannot pay twice.
  async function recordPayment(id, body, operator) {
    const c = mustGet(id);
    customersController.assertExpectedEndsAt(c, body);
    const inv = invoices.unsettled(c.id)[0];
    if (c.archivedAt || !inv) return customersController.recordPayment(id, body, operator);
    const label = inv.number || '(en préparation)';
    if (inv.status === 'open' && inv.payLinkId && qonto.ready()) {
      try {
        if (await checkInvoice(inv, operator)) {
          return { ...customersController.view(c.id), notice: `La facture ${label} vient d’être payée en ligne : abonnement renouvelé, aucun paiement à la main enregistré.` };
        }
      } catch {
        // Qonto unreachable: the operator's payment is recorded all the same.
      }
    }
    if (inv.payLinkId) {
      try {
        await qonto.deactivateLink(inv.payLinkId);
      } catch (err) {
        journal(c.id, operator, 'payment', `Lien de paiement de la facture ${label} non désactivé : ${errorText(err)}. Désactivez-le dans Qonto.`);
      }
    }
    const reference = String(body.reference || '').trim();
    settle(inv, { paidBy: 'manual', paidAt: stamp(), operator });
    if (reference) journal(c.id, operator, 'payment', `Référence du paiement de la facture ${label} : « ${reference} »`);
    return customersController.view(c.id);
  }

  // Rule 34: deprovisioning cancels what is still to pay, in Qonto too.
  async function cancelUnsettled(customerId, operator) {
    for (const inv of invoices.unsettled(customerId)) {
      invoices.update(inv.id, { status: 'cancelled' });
      drop(inv.id, 'le client est déprovisionné');
      try {
        if (inv.payLinkId) await qonto.deactivateLink(inv.payLinkId);
        if (inv.providerRef) await qonto.cancelInvoice(inv.providerRef);
        journal(customerId, operator, 'invoice', `Facture ${inv.number || '(non émise)'} annulée`);
      } catch (err) {
        journal(customerId, operator, 'invoice', `Facture ${inv.number} annulée ici, mais pas dans Qonto : ${errorText(err)}. Annulez-la dans Qonto.`);
      }
    }
  }

  async function deprovision(id, body, operator) {
    const view = await customersController.deprovision(id, body, operator);
    if (view.archivedAt) {
      await cancelUnsettled(view.id, operator);
      return customersController.view(view.id);
    }
    return view;
  }

  // --- alerts and the daily email (rule 18) ----------------------------------------------------

  function alerts() {
    const out = [];
    const live = customers.list().filter((c) => !c.archivedAt);
    if (live.length && !qonto.ready()) {
      out.push({ customerId: null, link: '/parametres/paiements', severity: 'warning', text: 'Qonto n’est pas connecté : aucune facture de renouvellement ne part. Réglages → Paiements.' });
    }
    for (const c of live) {
      for (const inv of invoices.unsettled(c.id)) {
        if (inv.status === 'pending' && inv.lastError) {
          out.push({ customerId: c.id, severity: inv.held ? 'error' : 'warning', text: `Facture non créée pour ${c.companyName} : ${inv.lastError}` });
        }
      }
    }
    const since = new Date(now().getTime() - FAILURE_ALERT_DAYS * 86400000).toISOString();
    for (const f of invoices.failuresSince(since)) {
      const c = customers.get(f.customerId);
      if (!c) continue;
      out.push({ customerId: c.id, severity: 'error', text: `Paiement échoué sur la facture ${f.number} de ${c.companyName} (${FAILURE_LABELS[f.status] || f.status}), le ${frDay(parisDay(new Date(f.at)))}.` });
    }
    return out;
  }

  async function sendDigest(lines, day) {
    if (!lines.length) return 0;
    const recipients = operators.list();
    const text = [
      ...lines,
      '',
      `Ouvrir la console : ${ctx.consoleUrl}/`,
    ].join('\n');
    for (const op of recipients) {
      await mailer.send({ to: op.email, subject: `Console GuestFlow — ${frDay(day)} : ${lines.filter((l) => l.startsWith('•')).length} point(s)`, text });
    }
    return recipients.length;
  }

  // The daily part (rule 17): invoices due today, then their emails; one customer's failure never
  // stops the others.
  async function runDaily(log = (msg) => console.log(msg)) {
    let issued = 0;
    for (const c of customers.list().filter((x) => !x.archivedAt)) {
      try {
        const inv = await ensureInvoice(c);
        if (inv && inv.status === 'open') issued += 1;
        await runEmails(customers.get(c.id));
      } catch (err) {
        log(`[billing] ${c.slug}: ${err.message}`);
      }
    }
    return issued;
  }

  return {
    scheduleOf,
    draftInvoice,
    ensureInvoice,
    retryInvoice,
    runEmails,
    runDaily,
    queue,
    sendQueued,
    ignoreQueued,
    remind,
    checkInvoice,
    checkPayments,
    checkCustomer,
    onLinkEvent,
    recordPayment,
    deprovision,
    alerts,
    sendDigest,
  };
}

module.exports = { createBillingController, scheduleOf, idempotencyKey, VAT_RATE };
