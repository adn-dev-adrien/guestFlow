/**
 * The « Fiche passage » of an outside booking (rule 53 of the campaigns spec), read whole for the administrator: who the client is, the session, what
 * each line of the sale is and what paid it, the payments and the money owed back, the terms the client accepted, how the visit went, and the journal of every
 * event newest first. It names no instrument of payment: a line paid in advance reads the words that instrument gave its tender.
 *
 *   ficheOf(row) → { booking, client, sessions, lines, totals, payments, refunds, terms, arrival, history }
 *
 * Everything is read, nothing is computed here but the order of the journal: money comes from the sale document (SETTLEMENT), the journal from `standalone_sale_history`.
 */

const sdk = require('../sdk');

const CHANNEL_LABELS = Object.freeze({
  site: 'Site', 'guest-app': 'Appli du séjour', 'payment-link': 'Lien de paiement', 'mon-bain': 'Mon bain',
});

function createFicheModel({ db, visits, marks }) {
  const core = () => sdk.coreModule('standaloneSale');
  const { lineLabel } = sdk.coreModule('paymentTenders');
  const termsModel = () => sdk.coreModule('termsModel');

  const resourceNameOf = (row) => (db.prepare('SELECT name FROM resources WHERE id = ?').get(row.resourceId) || {}).name || 'Ressource';

  function clientOf(row, document) {
    const stored = row.clientId ? db.prepare('SELECT id, firstName, lastName, email, phone FROM clients WHERE id = ?').get(row.clientId) : null;
    const linked = document && document.document.client && document.document.client.id && document.document.client.kind !== 'passage' ? document.document.client : null;
    const clientRow = stored || (linked ? db.prepare('SELECT id, firstName, lastName, email, phone FROM clients WHERE id = ?').get(linked.id) : null);
    const name = clientRow ? `${clientRow.firstName || ''} ${clientRow.lastName || ''}`.trim() : '';
    return {
      name: name || row.clientName || (document && document.document.customerName) || 'Client',
      email: (document && document.document.customerEmail) || (clientRow && clientRow.email) || null,
      phone: row.clientPhone || (clientRow && clientRow.phone) || null,
      clientId: clientRow ? clientRow.id : null,
    };
  }

  function termsOf(row) {
    const accepted = termsModel().findAcceptanceBySubject({ activity: 'resource', subjectType: 'outsideBooking', subjectRef: String(row.id) });
    if (!accepted) return [];
    const activity = sdk.coreModule('termsActivities').find(accepted.activity);
    return [{
      activity: accepted.activity,
      activityLabel: activity ? activity.label : accepted.activity,
      version: accepted.version,
      acceptedAt: accepted.acceptedAt,
      channel: accepted.channel,
      channelLabel: CHANNEL_LABELS[accepted.channel] || accepted.channel,
    }];
  }

  function linesOf(document, paidBy, marked) {
    return document.lines.map((line) => ({
      ref: line.ref,
      label: line.label,
      detail: line.detail,
      quantity: line.quantity,
      totalCents: line.totalCents,
      status: line.status,
      statusLabel: line.statusLabel,
      settledCents: line.settledCents,
      session: Boolean(line.fulfilmentRef),
      notTaken: marked.has(line.ref),
      paidBy: paidBy.filter((paid) => paid.lineRef === line.ref).map((paid) => ({ kind: paid.kind, label: paid.label, amountCents: paid.amountCents })),
    }));
  }

  function arrivalOf(row) {
    if (row.noShowAt) return { state: 'noShow', at: row.noShowAt };
    if (row.arrivedAt) return { state: 'arrived', at: row.arrivedAt };
    return { state: 'expected', at: null };
  }

  function ficheOf(row) {
    const saleId = visits().saleIdOf(row);
    const document = saleId ? visits().documentOf(row) : null;
    const paidBy = saleId ? core().paidByOf(saleId) : [];
    const marked = new Set(marks().marksOf(row.id).map((m) => m.lineRef));
    return {
      booking: {
        id: row.id, resourceId: row.resourceId, resourceName: resourceNameOf(row), date: row.date, startTime: row.startTime, endTime: row.endTime, people: row.people || null, notes: row.notes || '', saleRef: row.saleRef || null,
      },
      client: clientOf(row, document),
      sessions: [{ date: row.date, start: row.startTime, end: row.endTime, resourceName: resourceNameOf(row) }],
      lines: document ? linesOf(document, paidBy, marked) : [],
      totals: document ? document.totals : null,
      payments: saleId ? core().paymentsOf(saleId).map((payment) => ({
        id: payment.id, paidAt: payment.paidAt, receivedCents: payment.receivedCents, tenders: payment.tenders.map((tender) => ({ label: lineLabel(tender), amountCents: tender.amountCents })),
      })) : [],
      refunds: document ? document.refundObligations : [],
      terms: termsOf(row),
      arrival: arrivalOf(row),
      history: saleId ? [...core().historyOf(saleId)].reverse() : [{ at: row.createdAt, text: 'Réservation créée', actor: null }],
    };
  }

  return { ficheOf };
}

module.exports = { createFicheModel };
