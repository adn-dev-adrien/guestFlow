// Canonical platform names. After specs/normalize-platform-names.md
// (PR #118), the server stores `reservations.platform` as
// UpperCamelCase ('Airbnb', 'Gitedefrance', etc.) with 'direct' kept
// lowercase as the canonical enum value. The dropdown values below must
// match the stored form so a saved-then-reloaded form repopulates the
// `<Select>` correctly.
export const PLATFORMS = [
  'direct', 'Airbnb', 'Greengo', 'Abritel', 'Abracadaroom', 'Booking', 'Gitedefrance', 'Pitchup',
];

// Color map keyed by the slug form (lowercase, alphanumeric only). The lookup
// helper `getPlatformColor` normalizes any input shape to the slug before
// matching, so a UpperCamelCase platform name from the DB ('Airbnb',
// 'Gitedefrance'), a free-form label ('Gîtes de France'), or an iCal key all
// resolve to the same colour.
//
// Mirrors the server's `KNOWN_PLATFORM_COLORS` map (server/src/constants/platformColors.js).
// Custom colours pushed from the platforms-colors API are normalized at merge
// time in App.js.
export const PLATFORM_COLORS = {
  direct: '#c9a227',
  airbnb: '#FF5A5F',
  greengo: '#4CAF50',
  abritel: '#1565c0',
  abracadaroom: '#00bcd4',
  booking: '#003580',
  gitedefrance: '#e6c832',
  // The accent-stripped slug of the French plural "Gîtes de France" — same colour
  // so accidental data drift between Gite/Gites doesn't leave the calendar grey.
  gitesdefrance: '#e6c832',
  pitchup: '#f57c00',
};

export const DEFAULT_PLATFORM_COLOR = '#757575';

/**
 * Reduce any platform-name shape to its slug form: lowercase, alphanumeric only.
 * Examples:
 *   normalizePlatformKey('Airbnb')         → 'airbnb'
 *   normalizePlatformKey('GitesDeFrance')  → 'gitesdefrance'
 *   normalizePlatformKey('Gîtes de France')→ 'gtesdefrance' (NFD strip → 'Gtes de France' → slug)
 *   normalizePlatformKey('direct')         → 'direct'
 *   normalizePlatformKey('')               → ''
 *   normalizePlatformKey(null)             → ''
 *
 * NFD normalization strips combining marks (so 'î' → 'i') before slugging,
 * matching the canonical form spec `normalize-platform-names.md §3.1`.
 */
export function normalizePlatformKey(platform) {
  return String(platform || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getPlatformColor(platform) {
  const key = normalizePlatformKey(platform);
  if (!key) return DEFAULT_PLATFORM_COLOR;
  return PLATFORM_COLORS[key] || DEFAULT_PLATFORM_COLOR;
}

/**
 * Display label for a stored platform value. The DB stores canonical UpperCamelCase
 * ('Airbnb', 'Gitedefrance') which already reads fine; the only odd one is the lowercase
 * 'direct' enum value, capitalised here for display. Empty/unset → ''.
 */
export function formatPlatformLabel(platform) {
  const raw = String(platform || '').trim();
  if (!raw) return '';
  if (normalizePlatformKey(raw) === 'direct') return 'Direct';
  return raw;
}

/**
 * Predicate: is `platform` one of the well-known platforms (with a defined
 * brand colour)? Slug-normalises the input first so 'Airbnb', 'airbnb' and
 * 'AIRBNB' all answer `true`. Used by callers that need to distinguish
 * "iCal source uses a well-known platform" from "custom platform name".
 */
export function isKnownPlatformKey(platform) {
  const key = normalizePlatformKey(platform);
  return Boolean(key && PLATFORM_COLORS[key]);
}
