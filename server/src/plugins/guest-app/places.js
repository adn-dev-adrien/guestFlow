/**
 * « Pratique » — the shops, services and waste points around the estate (specs/guest-app/guest-app-local-amenities.md). Pure: the
 * stored rows and the clock come in, the validated rows and the guest's payload go out. No database, no request.
 */

const sdk = require('../sdk');
const { clockLabel } = require('./homeHighlight');
const { CATEGORIES, CATEGORY_KEYS } = require('./placeCategories');

const { toParisIso } = sdk.coreModule('stayWindow');

const WASTE_KINDS = Object.freeze({
  point: { fr: 'Point de collecte', en: 'Collection point' },
  decheterie: { fr: 'Déchèterie', en: 'Recycling centre' },
});
const ACCEPTS = Object.freeze({
  om: { fr: 'Ordures ménagères', en: 'Household waste' },
  emballages: { fr: 'Emballages', en: 'Packaging' },
  verre: { fr: 'Verre', en: 'Glass' },
  papier: { fr: 'Papier', en: 'Paper' },
  textile: { fr: 'Textile', en: 'Textiles' },
  vegetaux: { fr: 'Végétaux', en: 'Green waste' },
  encombrants: { fr: 'Encombrants', en: 'Bulky waste' },
});
const ENERGIES = Object.freeze({
  essence: { fr: 'Essence', en: 'Petrol' },
  gazole: { fr: 'Gazole', en: 'Diesel' },
  recharge: { fr: 'Recharge électrique', en: 'Electric charging' },
});

// Rule 12 — the estate's position until the Studio setting says otherwise; rule 16 — the map covers 15 km around it.
const DEFAULT_ESTATE = Object.freeze({ lat: 45.16369, lng: 4.63184 });
const MAX_KM = 15;
const COMMUNES = Object.freeze(['Satillieu', 'Saint-Romain-d’Ay', 'Saint-Alban-d’Ay']);
const STALE_MONTHS = 12;

const MAX_NAME = 80;
const MAX_COMMUNE = 60;
const MAX_NOTE = 280;
const MINUTES_PER_DAY = 1440;
const DAYS_FR = Object.freeze(['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']);
const DAYS_EN = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
// The table of a week reads Monday first; storage is Sunday first (rule 13).
const WEEK_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

const MESSAGES = Object.freeze({
  position: 'Position non reconnue : collez « 45.1502, 4.6151 » ou un lien Google Maps qui contient les coordonnées.',
  driveMinutes: 'Indiquez le temps en voiture depuis le domaine, en minutes (1 à 60).',
  accepts: 'Cochez au moins ce qu’on peut y déposer.',
  energies: 'Cochez au moins une énergie : essence, gazole ou recharge.',
  tooFar: (km) => `Ce lieu est à ${km} km du domaine : la carte couvre ${MAX_KM} km autour.`,
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInt = (value) => Number.isInteger(value);

// --- Position -----------------------------------------------------------------------------------------------

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const NUMBER = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PLAIN = new RegExp(`^\\s*${NUMBER}\\s*[,;\\s]\\s*${NUMBER}\\s*$`);
// A Google Maps link carries the pin as `!3d<lat>!4d<lng>` (the place itself), else the map's centre `@<lat>,<lng>`, else `q=<lat>,<lng>`.
const LINK_FORMS = Object.freeze([
  new RegExp(`!3d${NUMBER}!4d${NUMBER}`),
  new RegExp(`@${NUMBER},${NUMBER}`),
  new RegExp(`[?&](?:q|query|ll)=${NUMBER}(?:,|%2C)\\s*${NUMBER}`, 'i'),
]);

/** Rule 16 — « 45.1502, 4.6151 » or a Google Maps link carrying coordinates → `{ lat, lng }`, else null. */
function parsePosition(text) {
  if (typeof text !== 'string' || text.length > 2000) return null;
  const value = text.trim();
  const plain = PLAIN.exec(value);
  let pair = plain ? [plain[1], plain[2]] : null;
  if (!pair && /^https?:\/\//i.test(value)) {
    const found = LINK_FORMS.map((form) => form.exec(value)).find(Boolean);
    pair = found ? [found[1], found[2]] : null;
  }
  if (!pair) return null;
  const lat = Number(pair[0]);
  const lng = Number(pair[1]);
  return inRange(lat, lng) ? { lat, lng } : null;
}

/** Great-circle distance in kilometres. */
function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The position as the Studio shows it and the setting stores it: `45.1502, 4.6151`. */
const positionText = ({ lat, lng }) => `${lat}, ${lng}`;

/** Rule 12 — the estate's stored position (`lat, lng`), else the default. */
function estateOf(stored) {
  return parsePosition(String(stored || '')) || { ...DEFAULT_ESTATE };
}

/** Setting check of `estatePosition`. → an error message or null. */
function estateError(value) {
  if (value === null || value === '') return null;
  return parsePosition(String(value)) ? null : MESSAGES.position;
}

// --- Hours --------------------------------------------------------------------------------------------------

/** Rule 13 — 7 arrays (Sunday first) of `[openMin, closeMin]`, ≤ 2 a day. → `{ error }` or `{ hours }` (null when no day has a range). */
function checkHours(input) {
  if (input === null || input === undefined) return { hours: null };
  if (!Array.isArray(input) || input.length !== 7) return { error: 'Les horaires donnent les sept jours, du dimanche au samedi.' };
  const days = [];
  for (let day = 0; day < 7; day += 1) {
    const ranges = input[day];
    if (!Array.isArray(ranges)) return { error: 'Les horaires d’un jour sont une liste de plages.' };
    if (ranges.length > 2) return { error: `Deux plages au plus le ${DAYS_FR[day]}.` };
    const clean = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2 || !range.every(isInt) || range[0] < 0 || range[1] > MINUTES_PER_DAY) {
        return { error: `Une plage du ${DAYS_FR[day]} est invalide.` };
      }
      if (range[0] >= range[1]) return { error: `Le ${DAYS_FR[day]}, une plage doit ouvrir avant de fermer.` };
      clean.push([range[0], range[1]]);
    }
    clean.sort((a, b) => a[0] - b[0]);
    if (clean.length === 2 && clean[1][0] < clean[0][1]) return { error: `Le ${DAYS_FR[day]}, les deux plages se chevauchent.` };
    days.push(clean);
  }
  return { hours: days.some((ranges) => ranges.length) ? days : null };
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A minute of the day as written; midnight closes at « minuit ». */
function timeText(minutes, lang) {
  if (minutes >= MINUTES_PER_DAY) return lang === 'en' ? 'midnight' : 'minuit';
  return clockLabel(hhmm(minutes), lang);
}

/** The Europe/Paris wall clock of an instant: its weekday (0 = Sunday) and minute of the day. */
function parisClock(instant) {
  const iso = toParisIso(instant);
  const date = iso.slice(0, 10);
  return {
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    minutes: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)),
  };
}

const LABELS = Object.freeze({
  fr: {
    unknown: 'Horaires non renseignés',
    open: (at) => `Ouvert · ferme à ${at}`,
    opensToday: (at) => `Fermé · ouvre à ${at}`,
    opensTomorrow: (at) => `Fermé · ouvre demain à ${at}`,
    opensOn: (day, at) => `Fermé · ouvre ${day} à ${at}`,
    closedDay: 'Fermé',
  },
  en: {
    unknown: 'Hours not provided',
    open: (at) => `Open · closes at ${at}`,
    opensToday: (at) => `Closed · opens at ${at}`,
    opensTomorrow: (at) => `Closed · opens tomorrow at ${at}`,
    opensOn: (day, at) => `Closed · opens ${day} at ${at}`,
    closedDay: 'Closed',
  },
});

/** Rule 13 — `{ state: 'open' | 'closed' | 'unknown', label }` at the Paris time of `now`. A place with no hours never claims to be open. */
function openState(hours, now, lang = 'fr') {
  const text = LABELS[lang] || LABELS.fr;
  if (!hours) return { state: 'unknown', label: text.unknown };
  const { weekday, minutes } = parisClock(now);
  const today = hours[weekday];
  const current = today.find(([from, to]) => from <= minutes && minutes < to);
  if (current) return { state: 'open', label: text.open(timeText(current[1], lang)) };
  const later = today.find(([from]) => from > minutes);
  if (later) return { state: 'closed', label: text.opensToday(timeText(later[0], lang)) };
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = (weekday + ahead) % 7;
    if (hours[day].length) {
      const at = timeText(hours[day][0][0], lang);
      if (ahead === 1) return { state: 'closed', label: text.opensTomorrow(at) };
      return { state: 'closed', label: text.opensOn((lang === 'en' ? DAYS_EN : DAYS_FR)[day], at) };
    }
  }
  return { state: 'unknown', label: text.unknown };
}

/** Rule 6 — the week's table, Monday first: `[{ day, ranges, today }]`; null without hours. */
function hoursTable(hours, now, lang = 'fr') {
  if (!hours) return null;
  const text = LABELS[lang] || LABELS.fr;
  const { weekday } = parisClock(now);
  return WEEK_ORDER.map((day) => ({
    day: (lang === 'en' ? DAYS_EN : DAYS_FR)[day],
    ranges: hours[day].length
      ? hours[day].map(([from, to]) => `${timeText(from, lang)} – ${timeText(to, lang)}`).join(' · ')
      : text.closedDay,
    today: day === weekday,
  }));
}

// --- Rule 7 : the three GPS links, built from the stored coordinates ------------------------------------------

function gpsLinks({ lat, lng }) {
  return {
    apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  };
}

// --- Phone ---------------------------------------------------------------------------------------------------

/** French format, 10 digits (`04 75 12 34 56`, `+33 4 75 12 34 56`, `0475123456`) → the 10 digits, else null. */
function normalizePhone(text) {
  const digits = String(text).replace(/[\s.\-()]/g, '');
  const national = /^\+33[1-9]\d{8}$/.test(digits) ? `0${digits.slice(3)}` : digits;
  return /^0[1-9]\d{8}$/.test(national) ? national : null;
}

const phoneText = (digits) => digits.replace(/(\d{2})(?=\d)/g, '$1 ');

// --- Validation (rule 16) ------------------------------------------------------------------------------------

const FIELDS = Object.freeze([
  'category', 'nameFr', 'nameEn', 'commune', 'position', 'driveMinutes', 'wasteKind', 'accepts', 'energies', 'phone', 'noteFr', 'noteEn', 'hours', 'published',
]);

const blank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** A list of keys of a closed set, no repeat. */
const keysOf = (value, allowed) => Array.isArray(value) && value.every((k) => typeof k === 'string' && allowed.includes(k)) && new Set(value).size === value.length;

/**
 * Rule 16 — the Studio's body, judged whole. → `{ fields }` (one French message per refused field) or `{ place }`, the row to store
 * (coordinates parsed, lists kept in the closed sets' order, the fields the category does not use dropped).
 */
function validatePlace(body, { estate = DEFAULT_ESTATE } = {}) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !FIELDS.includes(key))) return { fields: { _: 'Requête invalide.' } };
  const fields = {};
  const text = (key, label, max, { required = false } = {}) => {
    const value = body[key];
    if (blank(value)) {
      if (required) fields[key] = `${label} est obligatoire.`;
      return null;
    }
    if (typeof value !== 'string' || value.trim().length > max) {
      fields[key] = `${label} fait ${max} caractères au plus.`;
      return null;
    }
    return value.trim();
  };

  const category = CATEGORY_KEYS.includes(body.category) ? body.category : null;
  if (!category) fields.category = 'Choisissez une catégorie.';
  const nameFr = text('nameFr', 'Le nom', MAX_NAME, { required: true });
  const nameEn = text('nameEn', 'Le nom anglais', MAX_NAME);
  const commune = text('commune', 'La commune', MAX_COMMUNE, { required: true });
  const noteFr = text('noteFr', 'La note', MAX_NOTE);
  const noteEn = text('noteEn', 'La note anglaise', MAX_NOTE);

  let lat = null;
  let lng = null;
  const position = parsePosition(body.position);
  if (!position) {
    fields.position = MESSAGES.position;
  } else {
    const km = distanceKm(estate, position);
    if (km > MAX_KM) fields.position = MESSAGES.tooFar(Math.ceil(km));
    else ({ lat, lng } = position);
  }

  if (!isInt(body.driveMinutes) || body.driveMinutes < 1 || body.driveMinutes > 60) fields.driveMinutes = MESSAGES.driveMinutes;

  let wasteKind = null;
  let accepts = null;
  let energies = null;
  if (category === 'dechets') {
    if (!Object.keys(WASTE_KINDS).includes(body.wasteKind)) fields.wasteKind = 'Choisissez un point de collecte ou une déchèterie.';
    else wasteKind = body.wasteKind;
    if (!Array.isArray(body.accepts) || body.accepts.length === 0) fields.accepts = MESSAGES.accepts;
    else if (!keysOf(body.accepts, Object.keys(ACCEPTS))) fields.accepts = 'Ce qu’on peut déposer est invalide.';
    else accepts = Object.keys(ACCEPTS).filter((k) => body.accepts.includes(k));
  }
  if (category === 'carburant') {
    if (!Array.isArray(body.energies) || body.energies.length === 0) fields.energies = MESSAGES.energies;
    else if (!keysOf(body.energies, Object.keys(ENERGIES))) fields.energies = 'Les énergies sont invalides.';
    else energies = Object.keys(ENERGIES).filter((k) => body.energies.includes(k));
  }

  let phone = null;
  if (!blank(body.phone)) {
    phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
    if (!phone) fields.phone = 'Le téléphone s’écrit en 10 chiffres, par exemple 04 75 12 34 56.';
  }

  const checked = checkHours(body.hours);
  if (checked.error) fields.hours = checked.error;

  if (body.published !== undefined && typeof body.published !== 'boolean') fields.published = 'Préciser si le lieu est publié.';

  if (Object.keys(fields).length) return { fields };
  return {
    place: {
      category,
      nameFr,
      nameEn,
      commune,
      lat,
      lng,
      driveMinutes: body.driveMinutes,
      wasteKind,
      accepts,
      energies,
      phone,
      noteFr,
      noteEn,
      hours: checked.hours,
      published: body.published === undefined ? true : body.published,
    },
  };
}

// --- The guest's payload (rules 4-7, 12-13) ----------------------------------------------------------------

const categoryOf = (key) => CATEGORIES.find((c) => c.key === key);

/** The name a language reads: English when written, else French. */
const nameIn = (place, lang) => (lang === 'en' && place.nameEn ? place.nameEn : place.nameFr);
const noteIn = (place, lang) => (lang === 'en' && place.noteEn ? place.noteEn : place.noteFr);

const driveLabel = (minutes, lang) => (lang === 'en' ? `${minutes} min drive` : `${minutes} min en voiture`);

/** Rule 5 — the category order of rule 10, then the drive time from the estate, then the name. */
function sortPlaces(places, lang = 'fr') {
  return places.slice().sort((a, b) => CATEGORY_KEYS.indexOf(a.category) - CATEGORY_KEYS.indexOf(b.category)
    || a.driveMinutes - b.driveMinutes
    || nameIn(a, lang).localeCompare(nameIn(b, lang), lang));
}

const labelled = (keys, table, lang) => (keys && keys.length ? keys.map((key) => ({ key, label: table[key][lang] || table[key].fr })) : null);

function guestPlace(place, { now, lang }) {
  const category = categoryOf(place.category);
  return {
    id: place.id,
    category: place.category,
    categoryLabel: lang === 'en' ? category.oneEn : category.oneFr,
    name: nameIn(place, lang),
    commune: place.commune,
    lat: place.lat,
    lng: place.lng,
    driveMinutes: place.driveMinutes,
    driveLabel: driveLabel(place.driveMinutes, lang),
    open: openState(place.hours, now, lang),
    hours: hoursTable(place.hours, now, lang),
    wasteKind: place.wasteKind ? { key: place.wasteKind, label: WASTE_KINDS[place.wasteKind][lang] || WASTE_KINDS[place.wasteKind].fr } : null,
    accepts: labelled(place.accepts, ACCEPTS, lang),
    energies: labelled(place.energies, ENERGIES, lang),
    note: noteIn(place, lang) || null,
    phone: place.phone ? phoneText(place.phone) : null,
    telUrl: place.phone ? `tel:${place.phone}` : null,
    verifiedOn: place.verifiedOn,
    links: gpsLinks(place),
  };
}

/** `GET /public/v1/guest/places` — the published places in server order, the categories that hold one, the estate. */
function guestPayload(places, { estate, now, lang = 'fr' }) {
  const ordered = sortPlaces(places, lang);
  const categories = CATEGORIES
    .map((c) => ({ key: c.key, label: lang === 'en' ? c.en : c.fr, count: ordered.filter((p) => p.category === c.key).length }))
    .filter((c) => c.count > 0);
  return { estate: { lat: estate.lat, lng: estate.lng }, categories, places: ordered.map((p) => guestPlace(p, { now, lang })) };
}

// --- The Studio's list (rules 14-15) -------------------------------------------------------------------------

/** Rule 14 — verified more than 12 months before `today` (`YYYY-MM-DD`). */
function isStale(verifiedOn, today) {
  if (!verifiedOn) return true;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() - STALE_MONTHS);
  return verifiedOn < limit.toISOString().slice(0, 10);
}

/** The stored shape the Studio reads and writes: the position as it is pasted, the review flag. */
function studioPlace(place, today) {
  return {
    id: place.id,
    category: place.category,
    nameFr: place.nameFr,
    nameEn: place.nameEn,
    commune: place.commune,
    position: positionText(place),
    lat: place.lat,
    lng: place.lng,
    driveMinutes: place.driveMinutes,
    wasteKind: place.wasteKind,
    accepts: place.accepts,
    energies: place.energies,
    phone: place.phone ? phoneText(place.phone) : null,
    noteFr: place.noteFr,
    noteEn: place.noteEn,
    hours: place.hours,
    published: place.published,
    verifiedOn: place.verifiedOn,
    needsReview: isStale(place.verifiedOn, today),
  };
}

/** Rule 15 — every category, in order, with its places (to re-verify first, then by name), its count and whether clients see it. */
function studioList(places, { today }) {
  const groups = CATEGORIES.map((c) => {
    const own = places.filter((p) => p.category === c.key).map((p) => studioPlace(p, today))
      .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || a.nameFr.localeCompare(b.nameFr, 'fr'));
    const publishedCount = own.filter((p) => p.published).length;
    return {
      key: c.key, label: c.fr, count: own.length, publishedCount, hiddenFromGuests: publishedCount === 0, places: own,
    };
  });
  return { groups, reviewCount: groups.reduce((sum, g) => sum + g.places.filter((p) => p.needsReview).length, 0) };
}

module.exports = {
  ACCEPTS,
  CATEGORIES,
  CATEGORY_KEYS,
  COMMUNES,
  DEFAULT_ESTATE,
  ENERGIES,
  MAX_KM,
  MESSAGES,
  WASTE_KINDS,
  distanceKm,
  estateError,
  estateOf,
  gpsLinks,
  guestPayload,
  isStale,
  normalizePhone,
  openState,
  parsePosition,
  positionText,
  sortPlaces,
  studioList,
  studioPlace,
  validatePlace,
};
