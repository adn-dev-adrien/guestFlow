/**
 * The two server-written lines of the home (specs/guest-app.md rules 5, 10, 11). Pure, with the instant as
 * an argument.
 */

const sdk = require('../sdk');
const { addDays, daysBetween, parisDate } = require('./currentStay');

const { toParisIso } = sdk.coreModule('stayWindow');

/** The Europe/Paris wall clock of an instant, as written: « 16 h », « 16 h 30 » / « 4 pm », « 4:30 pm ». */
function timeLabel(instant, lang = 'fr') {
  const [hour, minute] = toParisIso(instant).slice(11, 16).split(':').map(Number);
  const mm = String(minute).padStart(2, '0');
  if (lang !== 'en') return minute ? `${hour} h ${mm}` : `${hour} h`;
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 || 12;
  return minute ? `${h12}:${mm} ${suffix}` : `${h12} ${suffix}`;
}

const STATUS = {
  fr: {
    arrivalToday: (t) => `Arrivée aujourd’hui à partir de ${t}`,
    arrivalTomorrow: (t) => `Arrivée demain à partir de ${t}`,
    arrivalIn: (n) => `Arrivée dans ${n} jours`,
    departureToday: (t) => `Départ aujourd’hui avant ${t}`,
    departureTomorrow: (t) => `Départ demain avant ${t}`,
    day: (n, total) => `Jour ${n} sur ${total}`,
  },
  en: {
    arrivalToday: (t) => `Arriving today from ${t}`,
    arrivalTomorrow: (t) => `Arriving tomorrow from ${t}`,
    arrivalIn: (n) => `Arriving in ${n} days`,
    departureToday: (t) => `Leaving today before ${t}`,
    departureTomorrow: (t) => `Leaving tomorrow before ${t}`,
    day: (n, total) => `Day ${n} of ${total}`,
  },
};

/** Rule 10 — `window` is the stay's, for its check-in and check-out instants. */
function statusLine(stay, window, now, lang = 'fr') {
  const words = STATUS[lang] || STATUS.fr;
  const today = parisDate(now);
  const start = String(stay.startDate);
  const end = String(stay.endDate);
  const untilStart = daysBetween(start, today);
  const checkIn = timeLabel(window.checkIn, lang);
  const checkOut = timeLabel(window.checkOut, lang);
  if (untilStart > 1) return words.arrivalIn(untilStart);
  if (untilStart === 1) return words.arrivalTomorrow(checkIn);
  if (untilStart === 0) return words.arrivalToday(checkIn);
  const untilEnd = daysBetween(end, today);
  if (untilEnd <= 0) return words.departureToday(checkOut);
  if (untilEnd === 1) return words.departureTomorrow(checkOut);
  return words.day(1 - untilStart, daysBetween(end, start) + 1);
}

/** Rule 5 — what a guest who scanned before the window opened reads. */
function openingLine(opening, lang = 'fr') {
  const checkIn = timeLabel(opening.checkInAt, lang);
  const opens = timeLabel(opening.opensAt, lang);
  return lang === 'en'
    ? `Your stay starts today at ${checkIn} — the gate and the shop open at ${opens}.`
    : `Votre séjour commence aujourd’hui à ${checkIn} — le portail et la boutique s’ouvriront à ${opens}.`;
}

const welcomeLine = (name, lang = 'fr') => (lang === 'en' ? `Welcome to ${name}` : `Bienvenue à ${name}`);

const DEPARTURE_PAGE = 'depart';

// Most urgent first. An order waiting on the terrace goes cold, and a guest on arrival day needs the gate.
// The eve of departure comes before the bath: a slot is free on nearly every evening, so the other order
// would never let the departure instructions show.
const HIGHLIGHTS = Object.freeze([
  { key: 'order', module: 'orders', when: (f) => f.orderReady, text: { fr: 'Votre commande est prête', en: 'Your order is ready' } },
  { key: 'gate', module: 'gate', when: (f) => f.isArrivalDay && !f.gatePreparing, text: { fr: 'Le portail est actif', en: 'The gate is active' } },
  // Rule 13 — on arrival day, before Sowel has read the key: no time promised.
  {
    key: 'gatePreparing',
    module: 'gate',
    when: (f) => f.isArrivalDay && f.gatePreparing,
    text: { fr: 'Votre accès au portail se prépare', en: 'Your gate access is being prepared' },
    detail: { fr: 'La tuile Portail s’activera dès que votre accès sera prêt.', en: 'The Gate tile will light up as soon as your access is ready.' },
  },
  { key: 'departure', module: 'booklet', page: DEPARTURE_PAGE, when: (f) => f.isDepartureEve, text: { fr: 'Départ demain : les consignes', en: 'Leaving tomorrow: the instructions' } },
  { key: 'bath', module: 'bath', when: (f) => f.bathFreeToday, text: { fr: 'Prolongez votre bain nordique ce soir', en: 'Extend your nordic bath tonight' } },
]);

/**
 * Rule 11 — at most one card, only among the lodging's shown modules. `shown`: the keys of the shown
 * modules. `orderReady` and `bathFreeToday` come from the orders and the planning.
 */
function chooseHighlight({
  stay, now, shown, orderReady = false, bathFreeToday = false, gatePreparing = false, lang = 'fr',
}) {
  const today = parisDate(now);
  const facts = {
    orderReady,
    gatePreparing,
    bathFreeToday,
    isArrivalDay: String(stay.startDate) === today,
    isDepartureEve: addDays(today, 1) === String(stay.endDate),
  };
  const found = HIGHLIGHTS.find((h) => shown.includes(h.module) && h.when(facts));
  if (!found) return null;
  return {
    key: found.key,
    text: found.text[lang] || found.text.fr,
    ...(found.detail ? { detail: found.detail[lang] || found.detail.fr } : {}),
    module: found.module,
    ...(found.page ? { page: found.page } : {}),
  };
}

module.exports = { chooseHighlight, openingLine, statusLine, timeLabel, welcomeLine };
