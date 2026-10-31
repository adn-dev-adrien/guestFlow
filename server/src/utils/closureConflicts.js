/**
 * What stands on the nights of a proposed closure (specs/payment-link-lifecycle.md rules 40, 41, 49),
 * shaped for the closure dialog: one `{ label, detail, url }` line per stay or request, ready to print.
 *
 *   closureConflicts(model, { propertyId, startDate, endDate })
 *     → { reservations: [...], requests: [...], devis: [...] }
 *
 * `reservations` block the save (RESERVATION_OVERLAP), `requests` block it too (OPEN_PAYMENT_REQUEST:
 * an open link could still be paid on closed nights), `devis` only warn. A stay listed under
 * `reservations` is not listed again under `requests`: it has to move first, and its links go with it.
 */

const { formatEuros, shortDate } = require('./reservationLedger');
const { localIsoDate, localHourMinute } = require('./localDate');
const { guestName } = require('./paymentLinkLabel');

const reservationUrl = (id) => `/reservations/${Number(id)}`;
const devisUrl = (id) => `/reservations/new?mode=devis&devisId=${Number(id)}`;

const joined = (parts) => parts.filter(Boolean).join(' · ');
const span = (row, year) => `${shortDate(row.startDate, year)} → ${shortDate(row.endDate, year)}`;

// The end of an open link, in the operator's day and hour; null for Qonto's `0001-…` sentinel.
function validUntilLabel(expiresAt, year) {
  const ms = Date.parse(String(expiresAt || ''));
  if (!(ms > 0)) return null;
  const at = new Date(ms);
  return `lien valable jusqu’au ${shortDate(localIsoDate(at), year)} à ${localHourMinute(at)}`;
}

function closureConflicts(model, { propertyId = null, startDate, endDate }) {
  const year = String(startDate).slice(0, 4);
  const reservations = model.findReservationOverlaps(propertyId, startDate, endDate).map((r) => ({
    id: r.id,
    label: joined([r.reservationNumber || `#${r.id}`, guestName(r), span(r, year)]),
    detail: r.propertyName || '',
    url: reservationUrl(r.id),
  }));
  const blocking = new Set(reservations.map((r) => r.id));
  const requests = model.findOpenPaymentRequests(propertyId, startDate, endDate)
    .filter((l) => !blocking.has(l.reservationId))
    .map((l) => {
      const isDevis = l.kind === 'devis';
      const amountLabel = formatEuros(Number(l.amountCents || 0) / 100);
      const until = validUntilLabel(l.expiresAt, year);
      return {
        reservationId: l.reservationId,
        linkId: l.linkId,
        kind: l.kind,
        label: joined([
          isDevis ? `Devis ${l.devisNumber || `#${l.reservationId}`}` : `Réservation ${l.reservationNumber || `#${l.reservationId}`}`,
          guestName(l),
        ]),
        amountLabel,
        validUntilLabel: until,
        detail: joined([amountLabel, until]),
        url: isDevis ? devisUrl(l.reservationId) : reservationUrl(l.reservationId),
      };
    });
  const devis = model.findDevisWithoutLink(propertyId, startDate, endDate).map((d) => ({
    reservationId: d.reservationId,
    label: joined([`Devis ${d.devisNumber || `#${d.reservationId}`}`, guestName(d)]),
    detail: joined([d.propertyName, span(d, year), 'aucun lien en cours']),
    url: devisUrl(d.reservationId),
  }));
  return { reservations, requests, devis };
}

const MESSAGES = Object.freeze({
  RESERVATION_OVERLAP: 'Réservation sur ces dates : fermeture impossible.',
  OPEN_PAYMENT_REQUEST: 'Demande de paiement en cours sur ces dates : la retirer avant d’enregistrer la fermeture.',
});

module.exports = { closureConflicts, MESSAGES };
