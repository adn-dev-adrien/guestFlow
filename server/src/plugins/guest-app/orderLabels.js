/**
 * The words of an order, built by the server (specs/guest-app.md rules 38, 43-45): the guest's chips and notices,
 * the staff push and the orders page's labels. Pure: amounts, instants and the language come in.
 */

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
      offered: 'Offerte',
      paid_conflict: 'Payée · à rembourser',
      expired: 'Expirée',
      abandoned: 'Abandonnée',
    },
    planned: (when) => `Prévue ${when}`,
    delivered: 'Livrée',
    awaitingCard: 'Paiement par carte en attente',
    moved: (when) => `Livraison décalée au ${when}`,
    movedNone: 'Livraison à convenir avec l’équipe',
    modified: 'Modifiée par l’équipe',
    conflict: 'Le créneau n’était plus libre : l’équipe vous rembourse.',
    breakfast: (n, time) => `${n} matin${n > 1 ? 's' : ''} à ${time}`,
    included: 'Inclus',
    unavailable: 'Plus disponible',
    alreadyIncluded: 'Déjà inclus dans votre séjour',
    allowanceUsed: 'Limite atteinte pour votre séjour',
    morningUnavailable: 'Ce matin-là n’est plus possible à cette heure',
    slot: {
      taken: 'Ce créneau vient d’être pris',
      past: 'Ce créneau est passé',
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
      offered: 'Complimentary',
      paid_conflict: 'Paid · to be refunded',
      expired: 'Expired',
      abandoned: 'Abandoned',
    },
    planned: (when) => `Planned ${when}`,
    delivered: 'Delivered',
    awaitingCard: 'Card payment pending',
    moved: (when) => `Delivery moved to ${when}`,
    movedNone: 'Delivery to be arranged with the team',
    modified: 'Changed by the team',
    conflict: 'The slot was no longer free: the team will refund you.',
    breakfast: (n, time) => `${n} morning${n > 1 ? 's' : ''} at ${time}`,
    included: 'Included',
    unavailable: 'No longer available',
    alreadyIncluded: 'Already included in your stay',
    allowanceUsed: 'Limit reached for your stay',
    morningUnavailable: 'That morning is no longer possible at this time',
    slot: {
      taken: 'This slot has just been taken',
      past: 'This slot has passed',
      heating: 'The bath would not have time to heat up',
      staff: 'Nobody is there to light the bath',
      closed: 'Closed that day',
      duration: 'Impossible duration',
    },
  }),
});

const textOf = (lang) => TEXT[lang] || TEXT.fr;

/** Rule 38 — the status chip: the payment mode once the order stands, the moment of a card order before. */
function statusKey(order) {
  if (['confirmed', 'paid', 'delivered'].includes(order.status)) {
    if (order.payment === 'card') return 'paid';
    return order.payment === 'none' ? 'offered' : 'note';
  }
  return order.status;
}

function statusLabel(order, lang = 'fr') {
  return textOf(lang).status[statusKey(order)] || order.status;
}

/** Rule 38 — the second chip of an order with a delivery: « Prévue ven. 18 h 30 », then « Livrée ». */
function deliveryChip(order, lang = 'fr') {
  if (order.status === 'delivered') return textOf(lang).delivered;
  if (order.deliverAt && ['confirmed', 'paid'].includes(order.status)) return textOf(lang).planned(momentLabel(order.deliverAt, lang));
  return null;
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
function pushText(order, { lodging, firstName }) {
  const when = order.deliverAt ? ` pour ${timeLabel(parisMoment(order.deliverAt).time)}` : '';
  const prepared = order.lines.filter((l) => l.kind === 'option').map((l) => `${l.quantity} × ${l.title}`);
  const others = order.lines.filter((l) => l.kind !== 'option').map((line) => {
    if (line.kind === 'breakfast') return `${line.title} (${textOf('fr').breakfast((line.mornings || []).length, timeLabel(line.time))})`;
    if (Array.isArray(line.sessions) && line.sessions.length) {
      return `${hoursLabel(line.sessions)} ${String(line.title).toLowerCase()} ${dayLabel(line.sessions[0].date)} ${timeLabel(line.sessions[0].start)}`;
    }
    return `${line.quantity} × ${line.title}`;
  });
  const what = [prepared.length ? `${prepared.join(', ')}${when}` : null, ...others].filter(Boolean).join(', ');
  const mode = { card: 'payée par carte', note: 'sur la note', none: 'offerte' }[order.payment] || '';
  return `${lodging}${firstName ? ` · ${firstName}` : ''} — ${what}${mode ? ` (${mode})` : ''}`;
}

module.exports = {
  TEXT, dayLabel, deliveryChip, hoursLabel, lineLabel, momentLabel, parisMoment, priceLabel, pushText, sessionLabel, statusKey, statusLabel, textOf, timeLabel,
};
