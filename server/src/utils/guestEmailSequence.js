/**
 * Guest email sequence — the calendar, as pure functions (specs/guest-email-sequence.md §3.1-§3.4).
 *
 * Every date and every exclusion rule of the sequence lives here and nowhere else: the daily pass,
 * the simulation page and the CLI all call these functions, so what the simulation shows is exactly
 * what the pass would send. No DB access, no clock: `startDate` (the day automatic sending was first
 * turned on) and the snapshots are passed in.
 *
 * A plan entry is `{ stableKey, dedupKey, sendDate, reservationId, clientId, seasonKey, blocked }`
 * where `blocked` is null (eligible) or a reason code from REASONS. The ledger (already sent?) and the
 * yearly cap are applied by the runner, which owns the DB.
 */

const { isDirectChannel } = require('./platformNameFormat');

const MAIL = Object.freeze({
  CONFIRMATION: 'reservation_confirmation',
  J7: 'arrival_reminder_7d',
  J2: 'arrival_reminder_1d',
  J1: 'guest_thanks_j1',
  NOVEMBER: 'season_gift_vouchers',
  JANUARY: 'season_new_year',
});

const SEQUENCE_STABLE_KEYS = Object.freeze(Object.values(MAIL));
const STAY_STABLE_KEYS = Object.freeze([MAIL.CONFIRMATION, MAIL.J7, MAIL.J2, MAIL.J1]);
const SEASON_STABLE_KEYS = Object.freeze([MAIL.NOVEMBER, MAIL.JANUARY]);
// Rule 8 — what counts toward the « 3 contacts a year after the stay » cap.
const POST_STAY_STABLE_KEYS = Object.freeze([MAIL.J1, MAIL.NOVEMBER, MAIL.JANUARY]);
const POST_STAY_CAP = 3;
const RECENT_STAY_DAYS = 30;

const MAIL_LABELS = Object.freeze({
  [MAIL.CONFIRMATION]: 'Confirmation',
  [MAIL.J7]: 'J-7 · préparation',
  [MAIL.J2]: 'J-2 · arrivée',
  [MAIL.J1]: 'J+1 · merci et avis',
  [MAIL.NOVEMBER]: 'Bons cadeau',
  [MAIL.JANUARY]: 'Vœux et dates',
});

// Operator-facing reasons, French and ready to render (fat backend: the client never maps codes).
const REASONS = Object.freeze({
  cancelled: 'Séjour annulé',
  notDirect: 'Réservations directes uniquement',
  noEmail: 'Pas d\'adresse email',
  bookedWithinWeek: 'Réservée moins de 7 jours avant l\'arrivée',
  bookedWithinTwoDays: 'Réservée la veille ou l\'avant-veille : la confirmation porte l\'essentiel',
  notActivated: 'Envoi automatique pas encore activé',
  beforeActivation: 'Date antérieure à l\'activation : jamais d\'envoi rétroactif',
  stayBeforeActivation: 'Séjour terminé avant l\'activation de la séquence',
  clientOptedOut: 'Case client « Ne pas envoyer les mails après séjour »',
  unsubscribed: 'Client désinscrit des nouvelles',
  relayAddress: 'Adresse relais Airbnb / Booking',
  upcomingStay: 'Réservation en cours ou à venir',
  recentStay: 'Séjour terminé il y a moins de 30 jours',
  capReached: '3 contacts après séjour déjà envoyés sur 12 mois',
});

// ---------------------------------------------------------------- dates (ISO YYYY-MM-DD, UTC math)

function isoDate(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days)));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function lastDayOfFebruary(year) {
  return new Date(Date.UTC(Number(year), 2, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- keys

function stayDedupKey(stableKey, reservationId) {
  return `${stableKey}:r${Number(reservationId)}`;
}

function seasonKeyOf(stableKey, sendDate) {
  const year = sendDate.slice(0, 4);
  return stableKey === MAIL.NOVEMBER ? `${year}-11` : `${year}-01`;
}

function seasonDedupKey(stableKey, clientId, seasonKey) {
  return `${stableKey}:c${Number(clientId)}:${seasonKey}`;
}

// ---------------------------------------------------------------- channel helpers

function isRelayChannel(platform) {
  const p = String(platform || '').toLowerCase().replace(/[^a-z]/g, '');
  return p.startsWith('airbnb') || p.startsWith('booking');
}

function hasEmail(client) {
  return Boolean(client && String(client.email || '').trim());
}

// ---------------------------------------------------------------- stay mails (1-4)

/**
 * The four stay emails of one reservation.
 * @param {{ reservation: object, client: object|null, startDate: string|null }} input
 *   `startDate` = guestSequenceStartDate (YYYY-MM-DD) or null when never activated.
 */
function planStayMails({ reservation, client, startDate }) {
  const r = reservation || {};
  const rid = Number(r.id);
  const clientId = r.clientId == null ? null : Number(r.clientId);
  const created = isoDate(r.createdAt) || isoDate(r.startDate);
  const arrival = isoDate(r.startDate);
  const departure = isoDate(r.endDate);
  const cancelled = String(r.kind || 'reservation') !== 'reservation';

  const entry = (stableKey, sendDate, blocked) => ({
    stableKey, dedupKey: stayDedupKey(stableKey, rid), sendDate,
    reservationId: rid, clientId, seasonKey: null, blocked,
  });

  // Checks shared by every mail, in the order an operator would want to read the reason.
  const common = (sendDate) => {
    if (cancelled) return 'cancelled';
    if (!hasEmail(client)) return 'noEmail';
    if (!startDate) return 'notActivated';
    if (sendDate < startDate) return 'beforeActivation';
    return null;
  };

  const confirmation = (() => {
    if (cancelled) return 'cancelled';
    if (!isDirectChannel(r.platform)) return 'notDirect';
    return common(created);
  })();

  const j7Date = addDays(arrival, -7);
  const j2Date = addDays(arrival, -2);
  const j1Date = addDays(departure, 1);

  const j7 = cancelled ? 'cancelled' : (j7Date <= created ? 'bookedWithinWeek' : common(j7Date));
  const j2 = cancelled ? 'cancelled' : (j2Date <= created ? 'bookedWithinTwoDays' : common(j2Date));
  const j1 = (() => {
    if (cancelled) return 'cancelled';
    if (startDate && departure < startDate) return 'stayBeforeActivation';
    if (client && Number(client.postStayEmailsDisabled) === 1) return 'clientOptedOut';
    return common(j1Date);
  })();

  return [
    entry(MAIL.CONFIRMATION, created, confirmation),
    entry(MAIL.J7, j7Date, j7),
    entry(MAIL.J2, j2Date, j2),
    entry(MAIL.J1, j1Date, j1),
  ];
}

/** True when the confirmation must carry the arrival essentials: no J-2 will follow (rule 4). */
function isLastMinute(reservation) {
  const created = isoDate(reservation.createdAt) || isoDate(reservation.startDate);
  return addDays(isoDate(reservation.startDate), -2) <= created;
}

// ---------------------------------------------------------------- season mails (5-6)

/** The season send dates (15 November, 6 January) falling within [from, to]. */
function seasonSendDates(from, to) {
  const out = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const [stableKey, date] of [[MAIL.JANUARY, `${year}-01-06`], [MAIL.NOVEMBER, `${year}-11-15`]]) {
      if (date >= from && date <= to) out.push({ stableKey, sendDate: date });
    }
  }
  return out;
}

/**
 * One season email for one client, or null when the client is not a past guest at that date.
 * @param {{ stableKey, client, stays: object[], sendDate: string, startDate: string|null }} input
 *   `stays` = every reservation row of the client (any kind); cancelled ones are ignored here.
 */
function planSeasonMail({ stableKey, client, stays, sendDate, startDate }) {
  const live = (stays || []).filter((s) => String(s.kind || 'reservation') === 'reservation');
  const pastAll = live.filter((s) => isoDate(s.endDate) < sendDate);
  if (pastAll.length === 0) return null;

  const clientId = Number(client.id);
  const seasonKey = seasonKeyOf(stableKey, sendDate);
  const past = startDate ? pastAll.filter((s) => isoDate(s.endDate) >= startDate) : pastAll;
  const lastStay = (past.length ? past : pastAll)
    .slice()
    .sort((a, b) => (isoDate(b.endDate) > isoDate(a.endDate) ? 1 : -1))[0];

  const blocked = (() => {
    if (!hasEmail(client)) return 'noEmail';
    if (!startDate) return 'notActivated';
    if (sendDate < startDate) return 'beforeActivation';
    if (past.length === 0) return 'stayBeforeActivation';
    if (Number(client.postStayEmailsDisabled) === 1) return 'clientOptedOut';
    if (client.marketingUnsubscribedAt) return 'unsubscribed';
    if (past.every((s) => isRelayChannel(s.platform))) return 'relayAddress';
    if (live.some((s) => isoDate(s.endDate) >= sendDate)) return 'upcomingStay';
    if (stableKey === MAIL.NOVEMBER && daysBetween(isoDate(lastStay.endDate), sendDate) < RECENT_STAY_DAYS) return 'recentStay';
    return null;
  })();

  return {
    stableKey,
    dedupKey: seasonDedupKey(stableKey, clientId, seasonKey),
    sendDate,
    reservationId: Number(lastStay.id),
    clientId,
    seasonKey,
    blocked,
  };
}

/** The date before which the seasonal gift of rule 28 must be claimed. */
function giftDeadline(stableKey, sendDate) {
  const year = Number(sendDate.slice(0, 4));
  return stableKey === MAIL.NOVEMBER ? `${year}-12-15` : lastDayOfFebruary(year);
}

/** Rule 8: a post-stay email is capped once the client already received 3 in the past 365 days. */
function capReached(sentInPastYear) {
  return Number(sentInPastYear) >= POST_STAY_CAP;
}

module.exports = {
  MAIL,
  MAIL_LABELS,
  REASONS,
  SEQUENCE_STABLE_KEYS,
  STAY_STABLE_KEYS,
  SEASON_STABLE_KEYS,
  POST_STAY_STABLE_KEYS,
  POST_STAY_CAP,
  planStayMails,
  planSeasonMail,
  seasonSendDates,
  seasonKeyOf,
  stayDedupKey,
  seasonDedupKey,
  giftDeadline,
  capReached,
  isLastMinute,
  isRelayChannel,
  __test: { isoDate, addDays, daysBetween, lastDayOfFebruary },
};
