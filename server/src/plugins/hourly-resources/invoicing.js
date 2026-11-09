/**
 * Invoicing a resource booking sold outside a stay (specs/resource-booking-pricing-and-invoicing.md rules 2, 13-19, 25).
 *
 * The plugin never requires the issuer's plugin: it asks the core for the live issuer (`invoiceIssuers`). The invoice
 * copies the stored booking's breakdown; GuestFlow never numbers it (rule 16). A refusal keeps the payment (rule 25).
 */

const sdk = require('../sdk');

const ATTACH_WINDOW_DAYS = 7;
const cents = (euros) => Math.round(Number(euros || 0) * 100);
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

function createInvoicing({ bookings, issuers = () => sdk.coreModule('invoiceIssuers').current(), now = () => new Date(), logger = console }) {
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

  /** POST /:id/invoice — `{ ok, invoice }` or `{ error, status, code }`. Never touches the payment. */
  async function issue(id) {
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
      const known = {
        ISSUER_NEEDS_ADDRESS: 422, ISSUER_REAUTH: 409, ISSUER_AMOUNT_MISMATCH: 502, ISSUER_AMOUNT_UNREACHABLE: 422,
      }[err && err.code];
      if (known) return { error: err.message, status: known, code: err.code === 'ISSUER_NEEDS_ADDRESS' ? 'QONTO_NEEDS_ADDRESS' : err.code };
      logger.error(`[hourly-resources] invoice of booking ${id} failed:`, err && err.message);
      return { error: 'Qonto n’a pas répondu : la facture n’est pas créée, le paiement reste enregistré.', status: 502, code: 'ISSUER_FAILED' };
    }
    bookings().storeInvoice(id, {
      invoiceId: issued.invoiceId, number: issued.number, clientId: issued.clientId,
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
        if (Number(row.invoiceMarkPending) === 1) {
          if (status === 'paid') bookings().settleInvoiceMark(row.id, { markedPaid: true });
          else if (typeof issuer.markPaid === 'function') {
            // eslint-disable-next-line no-await-in-loop
            const marked = await issuer.markPaid({ invoiceId: row.qontoInvoiceId, paidAt: row.payment ? row.payment.paidAt : null });
            bookings().settleInvoiceMark(row.id, { markedPaid: Boolean(marked && marked.done) });
          }
        }
        // eslint-disable-next-line no-await-in-loop
        if (row.payment && row.payment.hasCard && row.invoice.attachment.state === 'pending') await attach(row.id);
      } catch (err) {
        logger.warn(`[hourly-resources] invoice watch of booking ${row.id}:`, err && err.message);
      }
    }
    return { checked: rows.length };
  }

  return { issue, attach, watch, requestOf };
}

module.exports = { createInvoicing, invoiceRefusal, ATTACH_WINDOW_DAYS };
