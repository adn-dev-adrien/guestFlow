/**
 * The list of gate keys the house reads, and the words guestFlow uses about them
 * (specs/gate-access-sowel-connector.md §3.1 and §3.3).
 *
 * guestFlow decides WHICH stays need a key and for WHICH window. It never creates one: the Sowel
 * plugin reads this list, creates or revokes the keys on its side, and posts the outcomes back.
 */

const {
  computeWindow,
  toParisIso,
  OPENS_BEFORE_CHECK_IN_MS,
  CLOSES_AFTER_CHECK_OUT_MS,
} = require('./gateWindow');

const DAY_MS = 24 * 60 * 60 * 1000;
/** A stay enters the list this long before its arrival (rule 2). */
const LEAD_DAYS = 7;
/** The house is late past this (rule 17). */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const ymd = (date) => date.toISOString().slice(0, 10);

/** « Gîte · R-2026-041 · Marie » — no family name, it has no business on a gate (rule 5). */
function keyLabel(stay) {
  if (!stay) return '';
  const number = stay.reservationNumber ? String(stay.reservationNumber).trim() : `#${stay.id}`;
  return [stay.propertyName, number, stay.clientFirstName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' · ');
}

/** The window and label of a stay as the house receives them, or null without dates. */
function describeStay(stay) {
  const window = computeWindow(stay);
  if (!window) return null;
  return {
    label: keyLabel(stay),
    startsAt: window.start.toISOString(),
    endsAt: window.end.toISOString(),
  };
}

/**
 * The `stay` block of contract v3 (specs/sowel-stays-in-keys.md): the property and the stay's own
 * check-in / check-out instants, without the gate's margins. `null` — and the key goes out without
 * it, the block is optional — when the property is not known any more.
 */
function stayBlock({ propertyId, propertyName, checkIn, checkOut }) {
  const id = Number(propertyId);
  if (propertyId === null || propertyId === undefined || !Number.isInteger(id) || id <= 0) return null;
  if (!propertyName) return null;
  const arrival = toParisIso(checkIn);
  const departure = toParisIso(checkOut);
  if (!arrival || !departure) return null;
  return { propertyId: id, propertyName: String(propertyName), arrival, departure };
}

/** The stay of a reservation that still exists: its own dates and times, as the gate window reads them. */
function stayOfReservation(stay) {
  const window = computeWindow(stay);
  if (!window) return null;
  return stayBlock({ ...stay, checkIn: window.checkIn, checkOut: window.checkOut });
}

/**
 * The stay of a DELETED reservation, from what was stored with its result: the listed window minus
 * its margins. NULL `propertyId` (a row filed before the column existed) → no block.
 */
function stayOfStoredResult(row) {
  const startMs = Date.parse(row.startsAt);
  const endMs = Date.parse(row.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return stayBlock({
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    checkIn: new Date(startMs + OPENS_BEFORE_CHECK_IN_MS),
    checkOut: new Date(endMs - CLOSES_AFTER_CHECK_OUT_MS),
  });
}

const withStay = (key, stay) => (stay ? { ...key, stay } : key);

/** A result that says a key may exist in Sowel: anything but a successful revoke (rule 6). */
function mayHoldKey(result) {
  if (!result || !result.action) return false;
  return !(String(result.action) === 'revoke' && Number(result.ok) === 1);
}

/**
 * GET /public/v1/gate/keys — rules 2-7.
 *
 * @param {ReturnType<import('../models/gateKeysModel')>} model
 * @param {Date} now
 */
function buildKeyList(model, now = new Date()) {
  const nowMs = now.getTime();
  const horizonMs = nowMs + LEAD_DAYS * DAY_MS;
  const keys = [];

  // Calendar days one wider on each side: the exact instants are decided below.
  const stays = model.activeStaysAround(ymd(new Date(nowMs - DAY_MS)), ymd(new Date(horizonMs + DAY_MS)));
  for (const stay of stays) {
    const described = describeStay(stay);
    if (!described) continue;
    const startMs = Date.parse(described.startsAt);
    const endMs = Date.parse(described.endsAt);
    if (endMs <= nowMs) continue;
    const hasKey = mayHoldKey({ action: stay.resultAction, ok: stay.resultOk });
    if (startMs > horizonMs && !hasKey) continue;
    keys.push(withStay({ reservationId: String(stay.id), action: 'create', ...described }, stayOfReservation(stay)));
  }

  for (const row of model.resultsWithoutLiveStay()) {
    if (!mayHoldKey(row)) continue;
    // A cancelled stay still has its dates; a deleted one only has the window listed with its key.
    const live = row.rowId ? { ...row, id: row.rowId, propertyId: row.livePropertyId } : null;
    const described = live ? describeStay(live) : null;
    const window = described || { label: row.label || `#${row.reservationId}`, startsAt: row.startsAt, endsAt: row.endsAt };
    if (!window.endsAt || Date.parse(window.endsAt) <= nowMs) continue;
    const stay = described ? stayOfReservation(live) : stayOfStoredResult(row);
    keys.push(withStay({ reservationId: String(row.reservationId), action: 'revoke', ...window }, stay));
  }

  return { now: now.toISOString(), keys };
}

/** Sowel's error codes, as a short French reason for the push and the dashboard (rule 15). */
const ERROR_REASONS = Object.freeze({
  disabled: "l'accès partagé est désactivé dans Sowel",
  unknown_profile: "le profil par défaut n'est pas accordé au plugin",
  profile_incomplete: 'le profil par défaut ne liste aucun portail',
  no_end: "le séjour n'a pas de date de fin",
  outside_profile: 'les dates sortent de celles du profil',
  invalid_date: 'les dates du séjour sont invalides',
  label_required: 'le libellé de la clé est vide',
  internal_error: 'erreur interne de Sowel',
  implausible_stay: 'séjour de plus de 31 jours refusé par Sowel',
});

function errorReason(result) {
  const code = result && result.error ? String(result.error) : '';
  if (ERROR_REASONS[code]) return ERROR_REASONS[code];
  const message = result && result.message ? String(result.message).trim() : '';
  return message || code || 'erreur inconnue';
}

/** « R-2026-041 · Marie » — the reservation as the push and the dashboard name it. */
function stayShortName(stay, result) {
  if (stay) {
    const number = stay.reservationNumber ? String(stay.reservationNumber).trim() : `#${stay.id}`;
    return [number, String(stay.clientFirstName || '').trim()].filter(Boolean).join(' · ');
  }
  // Deleted reservation: the stored label is « property · number · first name ».
  const parts = String((result && result.label) || '').split(' · ').slice(1);
  return parts.length ? parts.join(' · ') : `#${result ? result.reservationId : '?'}`;
}

function failureTitle(result) {
  return String(result && result.action) === 'revoke' ? 'Clé portail non révoquée' : 'Clé portail non créée';
}

/** Whether the house has stopped reading (rule 17): it read once, and not for more than 3 h. */
function isStale(lastReadAt, now = new Date()) {
  if (!lastReadAt) return false;
  const readMs = Date.parse(lastReadAt);
  if (!Number.isFinite(readMs)) return false;
  return now.getTime() - readMs > STALE_AFTER_MS;
}

module.exports = {
  LEAD_DAYS,
  STALE_AFTER_MS,
  ERROR_REASONS,
  keyLabel,
  describeStay,
  stayBlock,
  mayHoldKey,
  buildKeyList,
  errorReason,
  stayShortName,
  failureTitle,
  isStale,
};
