/**
 * The plugin's settings (specs/google-vacation-rentals-feed.md §4.1), stored in plugin_settings. No
 * secret: Google authenticates the partner by the source IP.
 *
 *   partnerId       the partner account Google opens after onboarding ('' until then)
 *   mode            'simulation' (default, nothing leaves the server) | 'envoi' (rules 15, 16)
 *   horizonDays     days ahead that are priced (default 365, rule 8)
 *   maxLos          longest stay priced, in nights (default 14, rule 4 — Q1)
 *   fullResendHour  local hour of the daily full re-send (default 4, rule 13)
 *   properties      JSON { "<propertyId>": { enabled, hotelCode, slug } } (rule 3)
 */

const MODES = Object.freeze(['simulation', 'envoi']);
const PARTNER_RE = /^[A-Za-z0-9_-]{2,64}$/;
const HOTEL_CODE_RE = /^[a-z0-9-]{3,40}$/;
const SLUG_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

const DEFAULTS = Object.freeze({ mode: 'simulation', horizonDays: '365', maxLos: '14', fullResendHour: '4', properties: '{}' });

const INTEGER_BOUNDS = Object.freeze({
  horizonDays: [30, 500, 'Entre 30 et 500 jours.'],
  maxLos: [1, 30, 'Entre 1 et 30 nuits.'],
  fullResendHour: [0, 23, 'Une heure entre 0 et 23.'],
});

/** « L'Estiva » → « l-estiva »: the default HotelCode and page slug of a property. */
function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** The stored JSON → { id: { enabled, hotelCode, slug } }, or null when it is not such an object. */
function parsePropertiesSetting(raw) {
  if (raw == null || raw === '') return {};
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(id) || !entry || typeof entry !== 'object') return null;
    out[id] = {
      enabled: entry.enabled === true || entry.enabled === 1 || entry.enabled === '1',
      hotelCode: String(entry.hotelCode || '').trim(),
      slug: String(entry.slug || '').trim().replace(/^\/+|\/+$/g, ''),
    };
  }
  return out;
}

function validateProperties(raw) {
  const parsed = parsePropertiesSetting(raw);
  if (!parsed) return 'Réglage des logements illisible.';
  const codes = new Set();
  for (const entry of Object.values(parsed)) {
    if (entry.hotelCode && !HOTEL_CODE_RE.test(entry.hotelCode)) return 'Code Google : lettres minuscules, chiffres et tirets, 3 à 40 caractères.';
    if (entry.slug && !SLUG_RE.test(entry.slug)) return 'Page du site : lettres minuscules, chiffres, tirets et « / ».';
    if (entry.enabled && entry.hotelCode) {
      if (codes.has(entry.hotelCode)) return 'Deux logements ne peuvent pas avoir le même code Google.';
      codes.add(entry.hotelCode);
    }
  }
  return null;
}

const anyEnabled = (parsed) => Object.values(parsed || {}).some((entry) => entry.enabled);

// store: ctx.settings ({ get, set, raw }).
function declared(store) {
  // A key sent with the write wins over the stored one: « Envoi » and the partner id arrive together.
  const current = (key, body) => (body && Object.prototype.hasOwnProperty.call(body, key) ? body[key] : store.get(key));
  const integer = (key) => (value) => {
    const [min, max, message] = INTEGER_BOUNDS[key];
    const n = Number(value);
    return value === '' || value == null || (Number.isInteger(n) && n >= min && n <= max) ? null : message;
  };
  return [
    {
      key: 'partnerId',
      validate: (value, body) => {
        const v = String(value ?? '').trim();
        if (v && !PARTNER_RE.test(v)) return 'Identifiant partenaire : lettres, chiffres, « - » et « _ ».';
        if (!v && current('mode', body) === 'envoi') return 'Identifiant partenaire requis en mode Envoi.';
        return null;
      },
    },
    {
      key: 'mode',
      default: DEFAULTS.mode,
      // Rule 16 — Envoi needs the partner id and at least one enabled property.
      validate: (value, body) => {
        if (!MODES.includes(String(value))) return 'Mode inconnu.';
        if (value !== 'envoi') return null;
        if (!String(current('partnerId', body) || '').trim()) return 'Envoi impossible : identifiant partenaire manquant.';
        if (!anyEnabled(parsePropertiesSetting(current('properties', body)))) return 'Envoi impossible : aucun logement activé.';
        return null;
      },
    },
    { key: 'horizonDays', default: DEFAULTS.horizonDays, validate: integer('horizonDays') },
    { key: 'maxLos', default: DEFAULTS.maxLos, validate: integer('maxLos') },
    { key: 'fullResendHour', default: DEFAULTS.fullResendHour, validate: integer('fullResendHour') },
    {
      key: 'properties',
      default: DEFAULTS.properties,
      validate: (value, body) => {
        const message = validateProperties(value);
        if (message) return message;
        if (current('mode', body) === 'envoi' && !anyEnabled(parsePropertiesSetting(value))) return 'Au moins un logement en mode Envoi.';
        return null;
      },
    },
  ];
}

// The settings as the feed reads them. `listProperties()` → [{ id, name }] of the core.
function createSettings({ store, listProperties }) {
  const int = (key) => {
    const n = Number(store.get(key));
    const [min, max] = INTEGER_BOUNDS[key];
    return Number.isInteger(n) && n >= min && n <= max ? n : Number(DEFAULTS[key]);
  };
  const config = () => parsePropertiesSetting(store.get('properties')) || {};
  return {
    partnerId: () => String(store.get('partnerId') || '').trim(),
    mode: () => (store.get('mode') === 'envoi' ? 'envoi' : 'simulation'),
    horizonDays: () => int('horizonDays'),
    maxLos: () => int('maxLos'),
    fullResendHour: () => int('fullResendHour'),
    // Every core property with its effective settings: an unset code or slug reads as the slug of its name.
    properties() {
      const stored = config();
      return listProperties().map((p) => {
        const entry = stored[String(p.id)] || {};
        return {
          id: Number(p.id),
          name: p.name,
          enabled: Boolean(entry.enabled),
          hotelCode: entry.hotelCode || slugify(p.name),
          slug: entry.slug || slugify(p.name),
        };
      });
    },
    enabledProperties() { return this.properties().filter((p) => p.enabled); },
  };
}

module.exports = {
  declared, createSettings, parsePropertiesSetting, validateProperties, slugify, MODES, HOTEL_CODE_RE,
};
