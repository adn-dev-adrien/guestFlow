/**
 * What the operator reads about Portier's accesses (specs/gate-access-portier.md §3.4, §6).
 *
 * Portier answers in ISO instants and codes (`contract.md` §3.3); the page, the fiche and the SAS show
 * French sentences on the Europe/Paris wall clock. That shaping lives here, on the server, so the
 * client renders strings and never does date arithmetic: the validity in words, the hours, the last
 * use, the house line, the two confirmations, and the wall-clock values an editor starts from.
 *
 * It also turns the editor's wall-clock values back into instants, with the same DST-safe conversion
 * the stay window uses (`gateWindow.js`).
 */

const { __test: { wallClockToDate } } = require('./gateWindow');

const TIME_ZONE = 'Europe/Paris';
const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parisParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const out = {};
  for (const { type, value } of PARTS.formatToParts(date)) out[type] = value;
  return out;
}

/** `12/09 à 16:00` */
function dayTime(iso) {
  const p = parisParts(iso);
  return p ? `${p.day}/${p.month} à ${p.hour}:${p.minute}` : '';
}

/** `08:15` */
function clock(iso) {
  const p = parisParts(iso);
  return p ? `${p.hour}:${p.minute}` : '';
}

/** `2026-09-20T09:00` — what a date + time input pair starts from. Empty for null. */
function wallClock(iso) {
  const p = parisParts(iso);
  return p ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` : '';
}

function sameParisDay(aIso, bIso) {
  const a = parisParts(aIso);
  const b = parisParts(bIso);
  return Boolean(a && b && a.year === b.year && a.month === b.month && a.day === b.day);
}

/** `depuis 06:12` today, `depuis le 12/09 à 06:12` otherwise. */
function sinceText(iso, nowMs) {
  if (!iso) return '';
  return sameParisDay(iso, new Date(nowMs).toISOString()) ? `depuis ${clock(iso)}` : `depuis le ${dayTime(iso)}`;
}

const STATE_LABELS = {
  before: 'pas encore actif',
  active: 'actif',
  after: 'terminé',
  suspended: 'suspendu',
  revoked: 'révoqué',
  deleted: 'supprimé',
};

function windowSentence(window) {
  const from = window && window.from;
  const until = window && window.until;
  if (from && until) return `du ${dayTime(from)} au ${dayTime(until)}`;
  if (from) return `à partir du ${dayTime(from)}`;
  if (until) return `jusqu'au ${dayTime(until)}`;
  return 'sans limite de dates';
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function validityText(access) {
  const window = access.window || {};
  if (access.kind === 'manual' && !window.from && !window.until) return 'Toujours valable';
  let text = capitalise(windowSentence(window));
  if (access.kind === 'stay') {
    if (access.earlyFrom) text += ' · ouvert en avance';
    if (access.extendedUntil) text += ' · prolongé à la main';
  }
  return text;
}

function hoursText(timeWindows) {
  if (!Array.isArray(timeWindows) || timeWindows.length === 0) return 'à toute heure';
  return timeWindows.map((w) => `${w.from} → ${w.until}`).join(', ');
}

function phonesText(count) {
  const n = Number(count) || 0;
  return `${n} téléphone${n > 1 ? 's' : ''}`;
}

function lastUseText(iso, nowMs) {
  if (!iso) return 'jamais';
  const elapsed = nowMs - Date.parse(iso);
  if (!Number.isFinite(elapsed) || elapsed < 60e3) return "à l'instant";
  const minutes = Math.floor(elapsed / 60e3);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

function tagOf(access, user) {
  if (access.createdBy === 'guestflow') return { key: 'guestflow', label: 'guestFlow' };
  const author = access.createdBy || {};
  if (user && String(author.id) === String(user.id)) return { key: 'mine', label: 'créé par moi' };
  return { key: 'other', label: `créé par ${String(author.email || '').split('@')[0] || 'un administrateur'}` };
}

function confirmations(access) {
  const n = Number((access.devices && access.devices.count) || 0);
  const label = `« ${access.label} »`;
  let invite;
  let regenerate;
  if (n === 0) {
    invite = `Le code et le QR de ${label} changent. Aucun téléphone n'est encore installé. L'ancien QR ne servira plus.`;
    regenerate = `${label} reçoit une nouvelle clé et un nouveau code. Aucun téléphone n'est encore installé. C'est ainsi qu'on coupe un téléphone perdu.`;
  } else if (n === 1) {
    invite = `Le code et le QR de ${label} changent. Le téléphone déjà installé continue. L'ancien QR ne servira plus.`;
    regenerate = `Le téléphone de ${label} s'arrête et devra être réinstallé avec le nouveau code. C'est ainsi qu'on coupe un téléphone perdu.`;
  } else {
    invite = `Le code et le QR de ${label} changent. Les ${n} téléphones déjà installés continuent. L'ancien QR ne servira plus.`;
    regenerate = `Les ${n} téléphones de ${label} s'arrêtent et devront être réinstallés avec le nouveau code. C'est ainsi qu'on coupe un téléphone perdu.`;
  }
  const remove = access.kind === 'stay' && access.reservation
    ? `${label} disparaît de la liste. Les modifications de la réservation ${access.reservation.number} seront ignorées ; seul « Recréer l'accès » sur la fiche le ramène.`
    : `${label} disparaît de la liste. Son journal reste.`;
  return { invite, regenerate, remove };
}

function accessView(access, { user, nowMs }) {
  const state = access.state;
  const deleted = state === 'deleted';
  // A finished stay is only there to be read for a week (the maquette of 2026-09-14): no action.
  const inactive = deleted || state === 'after';
  const stay = access.stay || null;
  return {
    id: access.id,
    kind: access.kind,
    label: access.label,
    state,
    stateLabel: STATE_LABELS[state] || state,
    tag: tagOf(access, user),
    subtitle: access.reservation
      ? `${access.reservation.propertyName} · ${access.reservation.number}`
      : `créé le ${dayTime(access.createdAt).split(' à ')[0]}`,
    reservationId: access.reservation ? access.reservation.id : null,
    code: (access.invitation && access.invitation.code) || '',
    validity: validityText(access),
    hours: hoursText(access.timeWindows),
    phones: Number((access.devices && access.devices.count) || 0),
    phonesLabel: phonesText(access.devices && access.devices.count),
    lastUse: lastUseText(access.devices && access.devices.lastUsedAt, nowMs),
    edit: {
      label: access.label,
      validFrom: wallClock(access.validFrom),
      validUntil: wallClock(access.validUntil),
      earlyFrom: wallClock(access.earlyFrom),
      extendedUntil: wallClock(access.extendedUntil),
      stayFrom: stay ? wallClock(stay.startsAt) : '',
      stayUntil: stay ? wallClock(stay.endsAt) : '',
      stayLabel: stay ? `Séjour : du ${dayTime(stay.startsAt)} au ${dayTime(stay.endsAt)} (départ + 1 h).` : '',
      timeWindows: Array.isArray(access.timeWindows) ? access.timeWindows.map((w) => ({ from: w.from, until: w.until })) : [],
    },
    actions: {
      edit: !inactive,
      invite: !inactive,
      regenerate: !inactive,
      suspend: !inactive && state !== 'suspended',
      resume: state === 'suspended',
      remove: !inactive,
      recreate: deleted,
    },
    note: state === 'after'
      ? "Cette ligne a quitté la liste toute seule à la fin du séjour. Elle reste ici sept jours, puis elle est purgée — personne n'a rien à supprimer."
      : '',
    confirm: confirmations(access),
  };
}

function houseLine(house, nowMs) {
  if (!house) return null;
  const since = sinceText(house.since, nowMs);
  if (house.link === 'up') {
    const gate = { open: 'portail ouvert', closed: 'portail fermé' }[house.gateState] || 'état du portail inconnu';
    return { up: true, text: `Maison connectée${since ? ` ${since}` : ''} · ${gate}` };
  }
  return { up: false, text: `Maison injoignable${since ? ` ${since}` : ''} — les clients lisent « maison injoignable »` };
}

const GROUPS = {
  current: [['active', 'Actifs', ['before', 'active']], ['suspended', 'Suspendus', ['suspended']], ['revoked', 'Révoqués', ['revoked']]],
  active: [['active', 'Actifs', ['before', 'active']]],
  suspended: [['suspended', 'Suspendus', ['suspended']]],
  finished: [['finished', 'Séjours terminés', null]],
};

const VIEWS = Object.keys(GROUPS);
const KINDS = ['all', 'mine', 'guestflow'];

function listView({ accesses, house }, { view, kind, user, nowMs }) {
  const views = (accesses || []).map((a) => accessView(a, { user, nowMs }))
    .filter((a) => kind === 'all' || a.tag.key === kind);
  return {
    house: houseLine(house, nowMs),
    groups: GROUPS[view]
      .map(([key, title, states]) => ({ key, title, accesses: views.filter((a) => !states || states.includes(a.state)) }))
      .filter((g) => g.accesses.length > 0),
  };
}

const EVENT_LABELS = {
  created: 'Accès créé',
  stay_applied: 'Séjour reçu de guestFlow',
  stay_ignored_deleted: 'Modification ignorée : accès supprimé',
  cancelled: 'Réservation annulée',
  reinstated: 'Réservation rétablie',
  updated: 'Accès modifié',
  suspended: 'Accès suspendu',
  resumed: 'Accès repris',
  invited: 'Nouvelle invitation',
  regenerated: 'Accès régénéré',
  deleted: 'Accès supprimé',
  recreated: 'Accès recréé',
  enrolled: 'Téléphone installé',
  enrol_refused: 'Installation refusée',
  open: "Demande d'ouverture",
  opened: 'Portail actionné',
  refused: 'Ouverture refusée',
};

const SOURCE_LABELS = { guest: 'client', owner: 'administrateur', guestflow: 'guestFlow', house: 'maison', portier: 'Portier' };

function eventView(event) {
  const actor = String(event.actor || '').split('|')[1] || '';
  return {
    id: event.id,
    at: dayTime(event.at),
    text: `${EVENT_LABELS[event.kind] || event.kind}${event.reason ? ` — ${event.reason}` : ''}`,
    who: actor || SOURCE_LABELS[event.source] || '',
  };
}

// ── The editor's values back to Portier (§3.4) ──────────────────────────────────────────────────

const REASON_MESSAGES = {
  label_required: "Un accès sans nom est un accès qu'on n'osera pas supprimer dans six mois.",
  range_end_not_after_start: 'La fin doit venir après le début.',
  early_not_before_stay: "Une ouverture anticipée doit précéder l'arrivée.",
  extend_not_after_stay: 'Une prolongation doit dépasser la fin du séjour. Pour couper plus tôt, c\'est « Suspendre ».',
  time_window_invalid: 'Une plage horaire doit finir après son début (pas de plage qui passe minuit).',
  time_windows_overlap: 'Deux plages se chevauchent — fusionnez-les.',
  field_not_allowed: "Ce champ ne se modifie pas sur ce type d'accès.",
  window_too_long: 'Un accès de séjour ne dépasse pas 60 jours.',
  starts_too_far: 'Un séjour ne commence pas plus de 18 mois à l’avance.',
  logo_required: 'Choisissez un fichier.',
  logo_type: 'Refusé : PNG, SVG ou JPEG seulement.',
  logo_too_big: 'Refusé : 2 Mo au plus.',
  logo_too_small: 'Refusé : au moins 512 × 512 px.',
  datetime_invalid: 'Date ou heure invalide.',
};

class AccessInputError extends Error {
  constructor(field, reason) {
    super(reason);
    this.field = field;
    this.reason = reason;
  }
}

const DATETIME_FIELDS = new Set(['validFrom', 'validUntil', 'earlyFrom', 'extendedUntil']);

function instantOf(field, value) {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(value));
  const date = match ? wallClockToDate(match[1], match[2]) : null;
  if (!date) throw new AccessInputError(field, 'datetime_invalid');
  return date.toISOString();
}

/**
 * Picks the allowed fields of an editor body and converts its wall-clock values. A field absent from
 * the body stays absent (PATCH semantics); `null` or `''` clears it.
 */
function accessWriteBody(body, allowed) {
  const out = {};
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    const value = body[field];
    if (DATETIME_FIELDS.has(field)) out[field] = instantOf(field, value);
    else if (field === 'timeWindows') {
      out.timeWindows = Array.isArray(value)
        ? value.map((w) => ({ from: String((w && w.from) || ''), until: String((w && w.until) || '') }))
        : [];
    } else out[field] = value == null ? null : String(value);
  }
  return out;
}

function refusalMessage(reason) {
  return REASON_MESSAGES[reason] || 'Portier a refusé cette valeur.';
}

module.exports = {
  dayTime,
  clock,
  wallClock,
  sinceText,
  windowSentence,
  STATE_LABELS,
  VIEWS,
  KINDS,
  accessView,
  listView,
  houseLine,
  eventView,
  lastUseText,
  phonesText,
  accessWriteBody,
  AccessInputError,
  refusalMessage,
  REASON_MESSAGES,
};
