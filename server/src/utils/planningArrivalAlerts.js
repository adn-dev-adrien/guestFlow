/**
 * Planning cleaning alerts (specs/planning-arrival-alerts.md §3 rules 1–3 and 7–10).
 *
 * Pure: given every stay around the window (including stays that started BEFORE it — a guest already
 * in the house leaving the day the next one arrives is the common case) and the properties' cleaning
 * hours, returns the alerts of each planning card, keyed by card kind:
 *
 *   { arrivals:   { [reservationId]: { type, explanation } },
 *     departures: { [reservationId]: { type, explanation, cleaningDisplay? } } }
 *
 * Every comparison is on real date + time (the stay's own check-in / check-out time), never on a
 * time of day alone and never on a substituted hour.
 */

const { formatTimeShort } = require('./dateFr');

const DEFAULT_CHECK_IN = '15:00';
const DEFAULT_CHECK_OUT = '10:00';
const DEFAULT_CLEANING_HOURS = 3;

const SIMULTANEOUS = 'Départs simultanés de plusieurs logements';
const CROSS_CLEANING = "Arrivée pendant nettoyage d'un autre logement";

// Naive minutes since epoch for a local date + HH:MM — both sides of every comparison use the same
// clock, so the time zone cancels out.
function stamp(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!m || !t) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])) / 60000;
}

function frDate(iso) {
  const [y, mo, d] = String(iso).split('-');
  return `${d}/${mo}/${y}`;
}

function cleaningLabel(hours) {
  return Number.isInteger(hours) ? `${hours}h` : String(hours).replace('.', 'h');
}

function guestName(stay) {
  const name = `${stay.firstName || ''} ${stay.lastName || ''}`.trim();
  return name || (stay.icalOriginalSummary && String(stay.icalOriginalSummary).trim()) || `Réservation #${stay.id}`;
}

function normalize(stay, cleaningHoursByProperty) {
  const raw = cleaningHoursByProperty[stay.propertyId];
  const hours = Number.isFinite(Number(raw)) && raw !== null && raw !== '' ? Number(raw) : DEFAULT_CLEANING_HOURS;
  const checkInTime = formatTimeShort(stay.checkInTime) || DEFAULT_CHECK_IN;
  const checkOutTime = formatTimeShort(stay.checkOutTime) || DEFAULT_CHECK_OUT;
  const checkoutAt = stamp(stay.endDate, checkOutTime);
  return {
    ...stay,
    checkInTime,
    checkOutTime,
    cleaningHours: hours,
    arrivalAt: stamp(stay.startDate, checkInTime),
    checkoutAt,
    cleaningEndAt: checkoutAt === null ? null : checkoutAt + Math.round(hours * 60),
  };
}

/**
 * @param {object} args
 * @param {Array}  args.stays — `{ id, propertyId, startDate, endDate, checkInTime, checkOutTime,
 *                              firstName, lastName, icalOriginalSummary }`, real reservations only.
 * @param {object} args.cleaningHoursByProperty — `{ [propertyId]: hours }`.
 * @param {string} args.from / args.to — the planning window (ISO dates, inclusive).
 */
function computePlanningAlerts({ stays = [], cleaningHoursByProperty = {}, from, to }) {
  const all = stays.map((s) => normalize(s, cleaningHoursByProperty))
    .filter((s) => s.arrivalAt !== null && s.checkoutAt !== null);
  const arrivals = {};
  const departures = {};
  const inWindow = (date) => date >= from && date <= to;

  // Rule 1 — turnover on the same logement: the latest checkout at or before the arrival, plus that
  // logement's cleaning, ends strictly after the arrival. Painted on BOTH cards of the turnover.
  for (const arrival of all) {
    const previous = all
      .filter((s) => s.id !== arrival.id && s.propertyId === arrival.propertyId && s.checkoutAt <= arrival.arrivalAt)
      .sort((a, b) => b.checkoutAt - a.checkoutAt)[0];
    if (!previous || previous.cleaningEndAt <= arrival.arrivalAt) continue;
    const cleaningDisplay = cleaningLabel(previous.cleaningHours);
    if (inWindow(arrival.startDate)) {
      arrivals[arrival.id] = {
        type: 'red',
        explanation: `${guestName(previous)} part le ${frDate(previous.endDate)} à ${previous.checkOutTime}, ménage: ${cleaningDisplay}`,
      };
    }
    if (inWindow(previous.endDate) && !departures[previous.id]) {
      departures[previous.id] = {
        type: 'red',
        explanation: `Arrivée de ${guestName(arrival)} ${frDate(arrival.startDate)} à ${arrival.checkInTime}, ménage: ${cleaningDisplay}`,
        cleaningDisplay,
      };
    }
  }

  // Rule 2 — an arrival while ANOTHER logement is being cleaned: that logement's checkout is at or
  // before the arrival and its cleaning is still running at the arrival time.
  for (const arrival of all) {
    if (!inWindow(arrival.startDate) || arrivals[arrival.id]) continue;
    const overlapping = all.some((s) => s.id !== arrival.id && s.propertyId !== arrival.propertyId
      && s.checkoutAt <= arrival.arrivalAt && s.cleaningEndAt > arrival.arrivalAt);
    if (overlapping) arrivals[arrival.id] = { type: 'blue', explanation: CROSS_CLEANING };
  }

  // Rule 3 — simultaneous departures: two logements or more leaving on the same date at the same
  // time. Painted on the departure rows; a red turnover alert keeps priority.
  for (const departure of all) {
    if (!inWindow(departure.endDate) || departures[departure.id]) continue;
    const twin = all.some((s) => s.id !== departure.id && s.propertyId !== departure.propertyId
      && s.checkoutAt === departure.checkoutAt);
    if (twin) departures[departure.id] = { type: 'orange', explanation: SIMULTANEOUS };
  }

  return { arrivals, departures };
}

module.exports = { computePlanningAlerts };
