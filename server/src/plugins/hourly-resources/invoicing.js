/**
 * Invoicing a resource booking sold outside a stay (specs/resource-booking-pricing-and-invoicing.md rules 2, 13-19, 25).
 *
 * The plugin never requires the issuer's plugin: it asks the core for the live issuer (`invoiceIssuers`). The invoice
 * copies the stored booking's breakdown; GuestFlow never numbers it (rule 16). A refusal keeps the payment (rule 25).
 *
 * A booking whose session is a line of a sale document (specs/outside-booking-sas.md rules 31, 34) is invoiced from the document: every money line
 * (the session's parts, the extras) at the rate frozen on it, once the document owes nothing (409 `REMAINING_DUE`) and holds no caisse interne. The
 * invoice columns stay on the booking (one booking, one document, one invoice); Qonto's total must equal the document's (`expectedTotalCents`).
 */

const sdk = require('../sdk');

const ATTACH_WINDOW_DAYS = 7;
const { toCents: cents } = sdk.coreModule('money');
const dayMs = 86400000;

/**
 * Rule 13 — why an invoice cannot be issued now, or null.
 * @param {object} row an enriched booking
 */
function invoiceRefusal(row, issuer) {
  if (row.reservationId) return { status: 409, code: 'BOOKING_HAS_STAY', error: 'Cette séance appartient à un séjour.' };
  if (row.frozen) return { status: 409, code: 'BOOKING_INVOICED', error: 'Déjà facturée.' };
  if (!(Number(row.totalPrice) > 0)) return { status: 400, code: 'NOTHING_TO_INVOICE', error: 'Total à 0 € : pas de facture.' };
  if (!row.payment) return { status: 400, code: 'NOT_PAID', error: 'Enregistrer d’abord le paiement.' };
  // Rule 43 — a « Payé » ticked before 1.4.0 names no method: it is no caisse interne, it is unknown.
  if (!row.payment.tenders.length) return { status: 400, code: 'NO_METHOD', error: 'Moyen de paiement non saisi : retirer le paiement puis l’enregistrer à nouveau.' };
  if (!row.payment.onTheBooks) return { status: 400, code: 'INTERNAL_CASH', error: 'Caisse interne : hors comptabilité.' };
  if (!issuer || !issuer.isReady()) return { status: 409, code: 'ISSUER_UNAVAILABLE', error: 'Facturation Qonto non connectée.' };
  return null;
}

// Rule 31 of the outside-visit spec — why the document of a visit cannot be invoiced now, or null.
function documentInvoiceRefusal(row, money, issuer) {
  if (row.reservationId) return { status: 409, code: 'BOOKING_HAS_STAY', error: 'Cette séance appartient à un séjour.' };
  if (row.frozen) return { status: 409, code: 'BOOKING_INVOICED', error: 'Déjà facturée.' };
  if (!(money.totalCents > 0)) return { status: 400, code: 'NOTHING_TO_INVOICE', error: 'Total à 0 € : pas de facture.' };
  if (money.remainingCents > 0) return { status: 409, code: 'REMAINING_DUE', error: 'Reste à payer : facture après le solde.' };
  if (money.payments.some((payment) => payment.tenders.some((t) => t.internal))) return { status: 400, code: 'INTERNAL_CASH', error: 'Caisse interne : hors comptabilité.' };
  if (!issuer || !issuer.isReady()) return { status: 409, code: 'ISSUER_UNAVAILABLE', error: 'Facturation Qonto non connectée.' };
  return null;
}

function createInvoicing({ bookings, visits = null, issuers = () => sdk.coreModule('invoiceIssuers').current(), now = () => new Date(), logger = console }) {
  // Rule 14 — one item per money line of the breakdown; the deductions go as one discount.
  function requestOf(basis) {
    const { row, breakdown, who } = basis;
    const rate = breakdown.vat ? breakdown.vat.rate : 0;
    const positive = breakdown.lines.filter((l) => l.amount > 0);
    const negative = breakdown.lines.filter((l) => l.amount < 0);
    const items = positive.map((l) => ({ title: `${basis.resource.name || 'Ressource'} · ${l.label}`, description: l.detail, amountCents: cents(l.amount), vatRate: rate }));
    const discountCents = negative.reduce((sum, l) => sum + cents(-l.amount), 0);
    return {
      idempotencyKey: `resource-booking:${row.id}:invoice:${row.invoiceCancelledAt ? Date.parse(row.invoiceCancelledAt) || 1 : 0}`,
      client: { ...who, countryCode: 'FR' },
      issueDate: row.payment.paidAt,
      performanceDate: row.date,
      items,
      discount: discountCents > 0 ? { title: negative.map((l) => l.label).join(' + '), amountCents: discountCents, vatRate: rate } : null,
      expectedTotalCents: cents(row.totalPrice),
      paid: true,
    };
  }

  // Rule 31 of the outside-visit spec — one item per money line of the document: the session's parts at its rate (its deductions as one discount),
  // each extra at its own rate. Offered and cancelled lines carry no money and are not sent.
  function documentRequestOf(basis, money) {
    const { row, who } = basis;
    const lines = money.document.lines.filter((line) => line.status === 'paid' && line.totalCents > 0);
    const items = [];
    let discount = null;
    for (const line of lines) {
      const parts = line.components && line.components.length ? line.components : null;
      if (!parts) {
        items.push({ title: line.label, description: line.detail || '', amountCents: line.totalCents, vatRate: Number(line.vatRate || 0) });
        continue;
      }
      parts.filter((part) => part.amountCents > 0).forEach((part) => items.push({ title: `${line.label} · ${part.label}`, description: part.detail || '', amountCents: part.amountCents, vatRate: Number(line.vatRate || 0) }));
      const deductions = parts.filter((part) => part.amountCents < 0);
      if (deductions.length) {
        discount = {
          title: deductions.map((part) => part.label).join(' + '), amountCents: -deductions.reduce((sum, part) => sum + part.amountCents, 0), vatRate: Number(line.vatRate || 0),
        };
      }
    }
    const last = money.payments[money.payments.length - 1];
    return {
      idempotencyKey: `resource-booking:${row.id}:invoice:${row.invoiceCancelledAt ? Date.parse(row.invoiceCancelledAt) || 1 : 0}`,
      client: { ...who, countryCode: 'FR' },
      issueDate: last.paidAt,
      performanceDate: row.date,
      items,
      discount,
      expectedTotalCents: money.totalCents,
      paid: true,
    };
  }

  async function issueDocument(id, money) {
    const basis = bookings().invoiceBasis(id);
    const row = bookings().findById(id);
    const issuer = issuers();
    const refusal = documentInvoiceRefusal(row, money, issuer);
    if (refusal) return refusal;
    const request = documentRequestOf({ ...basis, row }, money);
    let issued;
    try {
      issued = await issuer.issue(request);
    } catch (err) {
      return issueFailure(id, err);
    }
    const rates = [...new Set(request.items.map((item) => item.vatRate))];
    bookings().storeInvoice(id, {
      invoiceId: issued.invoiceId, number: issued.number, clientId: issued.clientId, clientIdentity: basis.clientIdentity,
      vatRate: rates.length === 1 ? rates[0] : null, total: sdk.coreModule('money').fromCentsStrict(money.totalCents), markedPaid: issued.markedPaid,
      markPending: Boolean(issued.markPending),
    });
    if (row.payment && row.payment.hasCard) {
      bookings().setAttachment(id, { state: 'pending' });
      await attach(id).catch(() => {});
    }
    return { ok: true, invoice: bookings().findById(id).invoice };
  }

  function issueFailure(id, err) {
    const known = {
      ISSUER_NEEDS_ADDRESS: 422, ISSUER_REAUTH: 409, ISSUER_AMOUNT_MISMATCH: 502, ISSUER_AMOUNT_UNREACHABLE: 422,
    }[err && err.code];
    if (known) return { error: err.message, status: known, code: err.code === 'ISSUER_NEEDS_ADDRESS' ? 'QONTO_NEEDS_ADDRESS' : err.code };
    logger.error(`[hourly-resources] invoice of booking ${id} failed:`, err && err.message);
    return { error: 'Qonto n’a pas répondu : la facture n’est pas créée, le paiement reste enregistré.', status: 502, code: 'ISSUER_FAILED' };
  }

  /** POST /:id/invoice — `{ ok, invoice }` or `{ error, status, code }`. Never touches the payment. */
  async function issue(id) {
    const raw = bookings().rawById(id);
    // The outside-visit spec rules 31, 34 — the session sold on a document is invoiced from it; a session paid on the booking keeps its own basis.
    const money = raw && raw.saleRef && visits && Number(raw.paid) !== 1 ? visits().moneyOf(raw) : null;
    if (money) return issueDocument(id, money);
    const basis = bookings().invoiceBasis(id);
    if (!basis) return { error: 'Réservation non trouvée', status: 404 };
    const issuer = issuers();
    const refusal = invoiceRefusal(basis.row, issuer);
    if (refusal) return refusal;
    // Rule 36 — the lines Qonto would state are today's tariff: when it moved since the payment, they no longer add up
    // to what was paid. Refused before Qonto numbers anything.
    if (cents(basis.breakdown.total) !== cents(basis.row.totalPrice)) {
      return { status: 409, code: 'TARIFF_CHANGED', error: 'Le tarif a changé depuis le paiement : facture à établir dans Qonto.' };
    }
    let issued;
    try {
      issued = await issuer.issue(requestOf(basis));
    } catch (err) {
      return issueFailure(id, err);
    }
    bookings().storeInvoice(id, {
      invoiceId: issued.invoiceId, number: issued.number, clientId: issued.clientId, clientIdentity: basis.clientIdentity,
      vatRate: basis.breakdown.vat ? basis.breakdown.vat.rate : null, total: Number(basis.row.totalPrice), markedPaid: issued.markedPaid,
      markPending: Boolean(issued.markPending),
    });
    if (basis.row.payment.hasCard) {
      bookings().setAttachment(id, { state: 'pending' });
      await attach(id).catch(() => {});
    }
    return { ok: true, invoice: bookings().findById(id).invoice };
  }

  /**
   * Rules 17-19 — joins the invoice's PDF to the day's card credit. `transactionId` given: the operator's choice
   * (« Choisir la transaction »). Returns the attachment state.
   */
  async function attach(id, { transactionId = null } = {}) {
    const row = bookings().findById(id);
    if (!row || !row.invoice || row.invoice.cancelled) return { error: 'Pas de facture à joindre.', status: 400 };
    if (row.invoice.attachment.state === 'attached') return { ok: true, attachment: row.invoice.attachment };
    const issuer = issuers();
    if (!issuer || !issuer.isReady()) return { error: 'Facturation Qonto non connectée.', status: 409, code: 'ISSUER_UNAVAILABLE' };
    try {
      const target = transactionId ? { transactionId } : await issuer.findCardBatch(row.payment.paidAt);
      if (!target) {
        const late = now().getTime() - Date.parse(`${row.payment.paidAt}T00:00:00Z`) > ATTACH_WINDOW_DAYS * dayMs;
        bookings().setAttachment(id, { state: late ? 'failed' : 'pending', error: late ? 'Aucun lot CB trouvé en 7 jours.' : null, countAttempt: true });
      } else {
        const done = await issuer.attach({ invoiceId: row.qontoInvoiceId, transactionId: target.transactionId, idempotencyKey: `resource-booking:${id}:attach:${target.transactionId}` });
        bookings().setAttachment(id, { state: 'attached', transactionId: target.transactionId, attachmentId: done.attachmentId, countAttempt: true });
      }
    } catch (err) {
      // A PDF Qonto has not rendered yet is the ordinary wait, not a failure.
      bookings().setAttachment(id, { state: 'pending', error: err && err.code === 'ISSUER_PDF_PENDING' ? null : String((err && err.message) || err).slice(0, 200), countAttempt: true });
    }
    return { ok: true, attachment: bookings().findById(id).invoice.attachment };
  }

  /** The hourly job: pending attachments (rule 18) and invoices cancelled by hand in Qonto (A2). */
  async function watch() {
    const issuer = issuers();
    if (!issuer || !issuer.isReady()) return { checked: 0 };
    const rows = bookings().invoicedToWatch();
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const status = await issuer.invoiceStatus(row.qontoInvoiceId);
        if (status === 'canceled' || status === 'cancelled') { bookings().markInvoiceCancelled(row.id); continue; }
        // Rule 38 — the « marquer payée » Qonto did not take at issue, tried again until it is paid there.
        // eslint-disable-next-line no-await-in-loop
        if (Number(row.invoiceMarkPending) === 1) await retryMark(issuer, row, status);
        // Rule 47 (R36-EXT-1) — the attachment never waits on the mark: a mark Qonto keeps refusing stops nothing else.
        // eslint-disable-next-line no-await-in-loop
        if (row.payment && row.payment.hasCard && row.invoice.attachment.state === 'pending') await attach(row.id);
      } catch (err) {
        logger.warn(`[hourly-resources] invoice watch of booking ${row.id}:`, err && err.message);
      }
    }
    return { checked: rows.length };
  }

  // Rule 47 — the mark is retried for ATTACH_WINDOW_DAYS after the issue, then left « à payer » in Qonto, as a 404/405/501.
  async function retryMark(issuer, row, status) {
    if (status === 'paid') { bookings().settleInvoiceMark(row.id, { markedPaid: true }); return; }
    if (typeof issuer.markPaid !== 'function') return;
    try {
      const marked = await issuer.markPaid({ invoiceId: row.qontoInvoiceId, paidAt: row.payment ? row.payment.paidAt : null });
      bookings().settleInvoiceMark(row.id, { markedPaid: Boolean(marked && marked.done) });
    } catch (err) {
      const issued = Date.parse(`${String(row.invoiceIssuedAt || '').replace(' ', 'T')}Z`);
      const late = Number.isFinite(issued) && now().getTime() - issued > ATTACH_WINDOW_DAYS * dayMs;
      if (late) bookings().settleInvoiceMark(row.id, { markedPaid: false });
      logger.warn(`[hourly-resources] invoice mark of booking ${row.id}${late ? ' given up' : ''}:`, err && err.message);
    }
  }

  return {
    issue, attach, watch, requestOf, documentRequestOf,
  };
}

module.exports = {
  createInvoicing, invoiceRefusal, documentInvoiceRefusal, ATTACH_WINDOW_DAYS,
};
