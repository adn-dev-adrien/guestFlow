/**
 * The words of an order, built by the server (specs/guest-app.md rules 38, 41bis-41ter, 43-45): the guest's chips,
 * notices and promise, the staff push and the orders page's labels. Pure: amounts, instants, the delivery mode and the
 * language come in. An order is `delivery` (« Livrée au logement ») or `pickup` (« À retirer », at a place typed once).
 */

const { roundMoney } = require('../sdk').coreModule('money');

const sdk = require('../sdk');

const { toParisIso } = sdk.coreModule('stayWindow');

const LOCALES = Object.freeze({ fr: 'fr-FR', en: 'en-GB' });

/** « 12 € », « 4,50 € » / « €12 », « €4.50 ». */
function priceLabel(amount, lang = 'fr') {
  const whole = Number.isInteger(Number(amount));
  return new Intl.NumberFormat(LOCALES[lang] || LOCALES.fr, {
    style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

/** « ven. 9 oct. » / « Fri 9 Oct ». */
function dayLabel(ymd, lang = 'fr') {
  return new Intl.DateTimeFormat(LOCALES[lang] || LOCALES.fr, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${ymd}T12:00:00Z`));
}

/** « 18 h », « 18 h 30 » / « 18:30 ». */
function timeLabel(hhmm, lang = 'fr') {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  if (lang === 'en') return `${h}:${String(m || 0).padStart(2, '0')}`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** An instant on the Paris wall clock: `{ date, time }`. */
function parisMoment(iso) {
  const paris = toParisIso(new Date(iso)) || '';
  return { date: paris.slice(0, 10), time: paris.slice(11, 16) };
}

/** « ven. 9 oct., 18 h 30 » — a delivery time. */
function momentLabel(iso, lang = 'fr') {
  const { date, time } = parisMoment(iso);
  return `${dayLabel(date, lang)}, ${timeLabel(time, lang)}`;
}

const sessionLabel = (s, lang) => `${dayLabel(s.date, lang)}, ${timeLabel(s.start, lang)} – ${timeLabel(s.end, lang)}`;

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** « 1 h », « 1 h 30 » / « 1 h 30 » — the length of the sessions of a line. */
function hoursLabel(sessions) {
  const minutes = (sessions || []).reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

const TEXT = Object.freeze({
  fr: Object.freeze({
    status: {
      awaiting_payment: 'En attente de paiement',
      paid: 'Payée',
      note: 'Sur votre note',
      dueOnArrival: 'À régler à l’arrivée',
      settled: 'Réglée',
      offered: 'Offerte',
      paid_conflict: 'Payée · à rembourser',
      expired: 'Expirée',
      abandoned: 'Abandonnée',
      cancelled: 'Annulée',
      stayCancelled: 'Séjour annulé',
    },
    amended: 'Modifiée à votre arrivée',
    planned: (when) => `Prévue ${when}`,
    ready: (when) => `Prête ${when}`,
    delivered: 'Livrée',
    pickedUp: 'Retirée',
    today: 'aujourd’hui',
    tomorrow: 'demain',
    on: (day) => `le ${day}`,
    promiseDelivery: (lodging, day, time) => `Livrée à ${lodging} ${day} vers ${time}`,
    promisePickup: (day, time, place) => `Prête ${day} à ${time}. Lieu de retrait : ${place}`,
    warm: (title, when) => `${title} — ${when}, il sera chaud`,
    later: 'Votre commande sera prête un peu plus tard que prévu',
    question: { delivery: 'Quand souhaitez-vous la recevoir ?', pickup: 'Quand souhaitez-vous la récupérer ?' },
    awaitingCard: 'Paiement par carte en attente',
    moved: (when) => `Livraison décalée au ${when}`,
    movedNone: 'Livraison à convenir avec l’équipe',
    modified: 'Modifiée par l’équipe',
    reviewTime: 'Horaire à revoir avec l’équipe',
    conflict: 'Le créneau n’était plus libre : l’équipe vous rembourse.',
    breakfast: (n, time) => `${n} matin${n > 1 ? 's' : ''} à ${time}`,
    included: 'Inclus',
    unavailable: 'Plus disponible',
    onSite: 'À commander sur place',
    allowanceUsed: 'Limite atteinte pour votre séjour',
    morningUnavailable: 'Ce matin-là n’est plus possible à cette heure',
    slot: {
      taken: 'Ce créneau vient d’être pris',
      past: 'Ce créneau est passé',
      outside: 'Ce créneau est hors de votre séjour',
      heating: 'Le bain n’aura pas le temps de chauffer',
      staff: 'Personne n’est là pour allumer le bain',
      closed: 'Fermé ce jour-là',
      duration: 'Durée impossible',
    },
  }),
  en: Object.freeze({
    status: {
      awaiting_payment: 'Awaiting payment',
      paid: 'Paid',
      note: 'On your bill',
      dueOnArrival: 'To pay on arrival',
      settled: 'Settled',
      offered: 'Complimentary',
      paid_conflict: 'Paid · to be refunded',
      expired: 'Expired',
      abandoned: 'Abandoned',
      cancelled: 'Cancelled',
      stayCancelled: 'Stay cancelled',
    },
    amended: 'Changed on your arrival',
    planned: (when) => `Planned ${when}`,
    ready: (when) => `Ready ${when}`,
    delivered: 'Delivered',
    pickedUp: 'Picked up',
    today: 'today',
    tomorrow: 'tomorrow',
    on: (day) => `on ${day}`,
    promiseDelivery: (lodging, day, time) => `Delivered to ${lodging} ${day} around ${time}`,
    promisePickup: (day, time, place) => `Ready ${day} at ${time}. Pick-up point: ${place}`,
    warm: (title, when) => `${title} — ${when}, it will be warm`,
    later: 'Your order will be ready a little later than planned',
    question: { delivery: 'When would you like it delivered?', pickup: 'When would you like to pick it up?' },
    awaitingCard: 'Card payment pending',
    moved: (when) => `Delivery moved to ${when}`,
    movedNone: 'Delivery to be arranged with the team',
    modified: 'Changed by the team',
    reviewTime: 'Time to review with the team',
    conflict: 'The slot was no longer free: the team will refund you.',
    breakfast: (n, time) => `${n} morning${n > 1 ? 's' : ''} at ${time}`,
    included: 'Included',
    unavailable: 'No longer available',
    onSite: 'To order on site',
    allowanceUsed: 'Limit reached for your stay',
    morningUnavailable: 'That morning is no longer possible at this time',
    slot: {
      taken: 'This slot has just been taken',
      past: 'This slot has passed',
      outside: 'This slot is outside your stay',
      heating: 'The bath would not have time to heat up',
      staff: 'Nobody is there to light the bath',
      closed: 'Closed that day',
      duration: 'Impossible duration',
    },
  }),
});

const textOf = (lang) => TEXT[lang] || TEXT.fr;

/**
 * Rules 38, 76 — the status chip: the payment mode once the order stands, the moment of a card order before. An order
 * collected at the arrival reads « À régler à l'arrivée » while the arrival complement is open, « Sur votre note » once it
 * is deferred to the departure, « Réglée » once collected (`arrival` is the stay's state, from its stored markers).
 */
function statusKey(order, { arrival = null } = {}) {
  if (order.status === 'cancelled') return 'cancelled';
  if (['confirmed', 'paid', 'delivered'].includes(order.status)) {
    if (order.payment === 'card') return 'paid';
    if (order.payment === 'none') return 'offered';
    if (order.collectAt === 'arrival' && arrival) return { open: 'dueOnArrival', deferred: 'note', collected: 'settled' }[arrival];
    return 'note';
  }
  return order.status;
}

function statusLabel(order, lang = 'fr', options = {}) {
  return textOf(lang).status[statusKey(order, options)] || order.status;
}

const isPickup = (order) => order.fulfilment === 'pickup';

/**
 * Rule 38 — the second chip of an order with a delivery: « Prévue ven. 18 h 30 », then « Livrée »; in pickup mode
 * « Prête ven. 18 h 30 », then « Retirée » (rule 41bis).
 */
function deliveryChip(order, lang = 'fr') {
  const T = textOf(lang);
  if (order.status === 'delivered') return isPickup(order) ? T.pickedUp : T.delivered;
  if (order.deliverAt && ['confirmed', 'paid'].includes(order.status)) {
    return (isPickup(order) ? T.ready : T.planned)(momentLabel(order.deliverAt, lang));
  }
  return null;
}

/** « aujourd'hui », « demain », « le ven. 9 oct. » — a day said from `now`. */
function relativeDay(date, now, lang = 'fr') {
  const T = textOf(lang);
  const today = parisMoment(now.toISOString()).date;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  if (date === today) return T.today;
  if (date === tomorrow) return T.tomorrow;
  return T.on(dayLabel(date, lang));
}

/** Rule 41bis — the delivery picker's question. */
const deliveryQuestion = (mode, lang = 'fr') => textOf(lang).question[mode === 'pickup' ? 'pickup' : 'delivery'];

/**
 * Rule 41ter — once the order stands (confirmed, or paid for a card order): « Livrée à L'Estiva aujourd'hui vers
 * 17 h 30 » or « Prête aujourd'hui à 17 h 30. Lieu de retrait : … ». Only the staff-prepared part carries a time:
 * an order without `deliverAt` has no promise. → `{ promise, extraPromises, movedNotice }`.
 */
function promiseOf(order, { lodging, now, lang = 'fr' }) {
  const T = textOf(lang);
  const standing = ['confirmed', 'paid'].includes(order.status);
  let promise = null;
  if (standing && order.deliverAt) {
    const { date, time } = parisMoment(order.deliverAt);
    const day = relativeDay(date, now, lang);
    promise = isPickup(order)
      ? T.promisePickup(day, timeLabel(time, lang), order.pickupPlace || '')
      : T.promiseDelivery(lodging, day, timeLabel(time, lang));
  }
  // An hourly resource keeps its own line: « Bain nordique — ven. 9 oct., 20 h, il sera chaud ».
  const extraPromises = standing
    ? order.lines.filter((l) => l.kind === 'resource' && Array.isArray(l.sessions) && l.sessions.length)
      .flatMap((l) => l.sessions.map((s) => T.warm(l.title, `${dayLabel(s.date, lang)}, ${timeLabel(s.start, lang)}`)))
    : [];
  return { promise, extraPromises, movedNotice: standing && order.deliverMoved && order.deliverAt ? T.later : null };
}

/** A line as a guest or the staff reads it: « 2 × Cidre », « Bain nordique · ven. 9 oct., 20 h – 21 h ». */
function lineLabel(line, lang = 'fr') {
  if (line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length) {
    return `${line.title} · ${line.sessions.map((s) => sessionLabel(s, lang)).join(' ; ')}`;
  }
  if (line.kind === 'breakfast') return `${line.title} · ${textOf(lang).breakfast((line.mornings || []).length, timeLabel(line.time, lang))}`;
  return `${line.quantity} × ${line.title}`;
}

/**
 * Rule 44 — « L'Estiva · Marie — 2 × Cidre pour 18 h, 1 h bain nordique ven. 20 h (sur la note) ». The staff reads
 * it in French; the breakfast is the breakfast card's, the bath the resource planning's, and both still say what
 * was ordered.
 */
function pushText(order, { lodging, firstName, now = new Date() }) {
  // Rule 75 — a time that is not today names its day: an order taken a week ahead is for another date.
  const moment = order.deliverAt ? parisMoment(order.deliverAt) : null;
  const day = moment && moment.date !== parisMoment(now.toISOString()).date ? `${dayLabel(moment.date)} ` : '';
  const at = moment ? `${day}${timeLabel(moment.time)}` : null;
  const when = at ? (isPickup(order) ? ` à retirer ${at}` : ` pour ${at}`) : '';
  const prepared = order.lines.filter((l) => l.kind === 'option').map((l) => `${l.quantity} × ${l.title}`);
  const others = order.lines.filter((l) => l.kind !== 'option').map((line) => {
    if (line.kind === 'breakfast') return `${line.title} (${textOf('fr').breakfast((line.mornings || []).length, timeLabel(line.time))})`;
    if (Array.isArray(line.sessions) && line.sessions.length) {
      return `${hoursLabel(line.sessions)} ${String(line.title).toLowerCase()} ${dayLabel(line.sessions[0].date)} ${timeLabel(line.sessions[0].start)}`;
    }
    return `${line.quantity} × ${line.title}`;
  });
  const what = [prepared.length ? `${prepared.join(', ')}${when}` : null, ...others].filter(Boolean).join(', ');
  const mode = order.collectAt === 'arrival' && order.payment === 'note'
    ? 'à régler à l’arrivée'
    : ({ card: 'payée par carte', note: 'sur la note', none: 'offerte' }[order.payment] || '');
  return `${lodging}${firstName ? ` · ${firstName}` : ''} — ${what}${mode ? ` (${mode})` : ''}`;
}

/** Rule 71 — one article line of an order as the arrival SAS reads it: « 2 × 6,00 € » (the quantity and the unit price). */
function unitLabel(line, lang = 'fr') {
  if (line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length) return line.sessions.map((s) => sessionLabel(s, lang)).join(' ; ');
  if (line.kind === 'breakfast') return textOf(lang).breakfast((line.mornings || []).length, timeLabel(line.time, lang));
  const price = Number(line.unitPrice);
  // Rule 100 — an article with free units reads its true part: « 2 × 6,50 € · 2 offerts », never « 4 × 6,50 € » beside a 13 € total.
  const billed = price > 0 ? roundMoney(Number(line.total) / price) : 0;
  if (price > 0 && Number.isInteger(billed) && billed >= 1 && billed < Number(line.quantity)) {
    const free = Number(line.quantity) - billed;
    return `${billed} × ${priceLabel(price, lang)} · ${free} ${lang === 'en' ? 'free' : `offert${free > 1 ? 's' : ''}`}`;
  }
  const unit = price > 0 ? ` × ${priceLabel(price, lang)}` : '';
  return `${line.quantity}${unit}`;
}

module.exports = {
  unitLabel, TEXT, dayLabel, deliveryChip, deliveryQuestion, hoursLabel, promiseOf, relativeDay, lineLabel, momentLabel, parisMoment, priceLabel, pushText, sessionLabel, statusKey, statusLabel, textOf, timeLabel,
};
