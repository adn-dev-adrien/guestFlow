/**
 * Reception-scoped payload serializers (specs/reception-role-checkin-only.md §3.2, §4.1).
 *
 * The `reception` role welcomes guests on-site (arrival / departure SAS) and must NEVER receive any
 * financial figure beyond the caution + complement to collect at the door — and no client contact
 * PII. Since the Dashboard and Planning fetch reservations via the shared `GET /reservations` and
 * `GET /reservations/:id` endpoints (full-finance payloads), the controllers run the payload through
 * these serializers when — and only when — the requester is reception-only.
 *
 * Whitelist, not blacklist: only the fields listed below survive, so a new financial column added
 * later can never silently leak to a reception account.
 *
 * Pure functions — unit-tested in tests/reception-view.unit.test.js.
 */

const { isWithinSasWindow, sasLockReason } = require('./sasEditWindow');

// Operational reservation fields the reception UI (Dashboard rows, ReservationCard,
// DepartureMiniRow) needs. Money kept: cautionAmount / complementAmount / endOfStayComplement — the
// door money. Money dropped: total/deposit/balance/remainingDue/commission/tourist-tax/contribs.
// PII dropped: email / phone / address.
const RESERVATION_KEEP = [
  'id',
  'reservationNumber',
  'kind',
  'clientId',
  'firstName',
  'lastName',
  'name',
  'propertyId',
  'propertyName',
  'propertyPhoto',
  'platform',
  'startDate',
  'endDate',
  'checkInTime',
  'checkOutTime',
  'adults',
  'children',
  'teens',
  'babies',
  'babyBeds',
  // Bed config for the "Lits à préparer" column (operational housekeeping, not financial).
  'doubleBeds',
  'singleBeds',
  'notes',
  'bedLinenAlert',
  // Door money (allowed for reception).
  'cautionAmount',
  'cautionReceived',
  'cautionReceivedDate',
  'cautionReturned',
  'cautionReturnedDate',
  'complementAmount',
  'complementPaid',
  'endOfStayComplementAmount',
  'endOfStayComplementPaid',
  // « En fin de séjour » marker: labels the complement as collected at check-out, no amount added
  // (specs/defer-arrival-complement-to-checkout.md §3.2 rule 10).
  'complementDeferredToCheckout',
  // Operational status flags.
  'checkInReady',
  'checkInDone',
  'checkOutDone',
  'arrivalSasDoneAt',
  'departureSasDoneAt',
];

// Option / resource lines are shown as "title × quantity" only — their prices are stripped.
function receptionOptionLine(o) {
  return {
    id: o.id,
    optionId: o.optionId,
    customOptionId: o.customOptionId,
    title: o.title,
    quantity: o.quantity,
    autoOptionType: o.autoOptionType,
    isCustom: o.isCustom,
  };
}

function receptionResourceLine(rr) {
  return {
    id: rr.id,
    resourceId: rr.resourceId,
    name: rr.name,
    quantity: rr.quantity,
  };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

/**
 * Finance-free, PII-free view of one reservation (list row or detailed object).
 *
 * Also carries the resolved edit locks (specs/reception-sas-today-only.md §3.2 rule 9) so the client
 * never does date math: `arrivalSasLock` / `departureSasLock` (null | 'done' | 'future' | 'past')
 * and the two status-toggle flags. Admin payloads never go through here, hence never carry them —
 * every consumer reads an absent field as "no lock".
 *
 * @param {object} reservation - a row from reservationsModel.list() or getByIdWithDetails().
 * @param {Date} [now] - reference instant for the day window (server clock).
 * @returns {object} the reception-safe projection.
 */
function toReceptionReservationView(reservation, now = new Date()) {
  if (!reservation) return reservation;
  const view = pick(reservation, RESERVATION_KEEP);
  if (Array.isArray(reservation.options)) {
    view.options = reservation.options.map(receptionOptionLine);
  }
  if (Array.isArray(reservation.resources)) {
    view.resources = reservation.resources.map(receptionResourceLine);
  }
  view.arrivalSasLock = sasLockReason({ dateIso: reservation.startDate, doneAt: reservation.arrivalSasDoneAt, now });
  view.departureSasLock = sasLockReason({ dateIso: reservation.endDate, doneAt: reservation.departureSasDoneAt, now });
  // The toggles follow the DAY window only — a committed SAS still leaves them editable until the
  // window closes (§3.2 rule 6).
  view.checkInStatusEditable = isWithinSasWindow(reservation.startDate, now);
  view.checkOutStatusEditable = isWithinSasWindow(reservation.endDate, now);
  return view;
}

function toReceptionReservationList(reservations, now = new Date()) {
  return (reservations || []).map((r) => toReceptionReservationView(r, now));
}

// Property display fields the reception Planning needs (name + photo for the columns). Pricing,
// default caution, cleaning price, seasons, documents, etc. are all dropped.
const PROPERTY_KEEP = ['id', 'name', 'photo', 'color', 'sortOrder', 'isActive'];

/**
 * Finance-free view of one property (id + display name + photo).
 * @param {object} property - a row from propertiesModel.list().
 * @returns {object} the reception-safe projection.
 */
function toReceptionPropertyView(property) {
  if (!property) return property;
  return pick(property, PROPERTY_KEEP);
}

function toReceptionPropertyList(properties) {
  return (properties || []).map(toReceptionPropertyView);
}

// specs/reception-role-checkin-only.md §3.5 rule 10 — the ONLY reservation fields a reception-only
// user may write through `PATCH /reservations/:id/payment`. Every financial field in the incoming
// body (deposit / balance / complement / caution / amounts) is dropped.
function toReceptionPaymentPatch(body) {
  const { checkInReady, checkInDone, checkOutDone } = body || {};
  return { checkInReady, checkInDone, checkOutDone };
}

// specs/collect-stay-payment-at-check-in.md §3.6 rule 24 — the « Séjour à régler » step is admin-only:
// the acompte / solde are exactly what this role must never see. The shell keeps the shape the client
// expects (`applicable` decides whether the step exists) while carrying no amount at all.
const RECEPTION_STAY_PAYMENT = Object.freeze({ applicable: false });

function toReceptionStayPayment() {
  return { ...RECEPTION_STAY_PAYMENT };
}

/**
 * Rule 25 — fail-closed on the write side: a reception-only SAS commit never settles the stay.
 * The two fields are DROPPED, not rejected: a stale client must not lose a whole check-in over a
 * field it should not have sent. Everything else in the body rides through untouched.
 */
function toReceptionSasCommit(body) {
  const { stayPaid, stayPaidCash, ...rest } = body || {};
  return rest;
}

module.exports = {
  toReceptionReservationView,
  toReceptionReservationList,
  toReceptionPropertyView,
  toReceptionPropertyList,
  toReceptionPaymentPatch,
  toReceptionStayPayment,
  toReceptionSasCommit,
  RESERVATION_KEEP,
  PROPERTY_KEEP,
};
