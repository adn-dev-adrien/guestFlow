// Canonical platform names. After specs/normalize-platform-names.md
// (PR #118), the server stores `reservations.platform` as
// UpperCamelCase ('Airbnb', 'Gitedefrance', etc.) with 'direct' kept
// lowercase as the canonical enum value. The dropdown values below must
// match the stored form so a saved-then-reloaded form repopulates the
// `<Select>` correctly.
export const PLATFORMS = [
  'direct', 'Airbnb', 'Greengo', 'Abritel', 'Abracadaroom', 'Booking', 'GitesDeFrance', 'Pitchup',
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
 * ('Airbnb', 'GitesDeFrance') which already reads fine; the lowercase 'direct' enum value is
 * capitalised here for display, and so is any value whose stored spelling drifted to lowercase
 * ('abracadaroom' → 'Abracadaroom'). Only the FIRST character is touched: the inner capitals of
 * 'GitesDeFrance' carry its word boundaries and must survive. Empty/unset → ''.
 */
export function formatPlatformLabel(platform) {
  const raw = String(platform || '').trim();
  if (!raw) return '';
  if (normalizePlatformKey(raw) === 'direct') return 'Direct';
  // A mixed-case spelling carries word boundaries in its inner capitals ('GitesDeFrance'), so only
  // the first character is touched. An all-caps one ('BOOKING') carries none, so its tail is
  // lowercased rather than shouted.
  const tail = /[a-z]/.test(raw) ? raw.slice(1) : raw.slice(1).toLowerCase();
  return raw.charAt(0).toUpperCase() + tail;
}

/**
 * Merge platform-name variants that differ only by case or punctuation into ONE entry.
 *
 * The server stores a canonical name (specs/normalize-platform-names.md), but a value can drift
 * between two boots — an iCal sync writing the feed slug, a legacy row — and the operator must
 * never see the same platform listed twice ('Abracadaroom' + 'abracadaroom'). Groups by slug and
 * keeps the best-spelled variant — the canonical mixed-case one, the only spelling that carries the
 * inner word boundaries ('GitesDeFrance' over 'gites-de-france' or 'GITESDEFRANCE'). Sorted by label
 * so the list is stable as more data loads.
 *
 * @param {Array<string|null>} platforms raw stored platform values, duplicates allowed
 * @returns {Array<{ platform: string, label: string, color: string }>} one entry per platform
 */
// How close a spelling is to the canonical form: mixed-case starting with a capital beats all-caps,
// which beats anything starting lowercase. Ties keep the first value seen.
function spellingScore(raw) {
  if (!/^[A-Z]/.test(raw)) return 0;
  return /[a-z]/.test(raw) ? 2 : 1;
}

export function mergePlatformVariants(platforms) {
  const bySlug = new Map();
  for (const platform of platforms || []) {
    const key = normalizePlatformKey(platform);
    if (!key) continue;
    const raw = String(platform).trim();
    const current = bySlug.get(key);
    if (!current || spellingScore(raw) > spellingScore(current)) bySlug.set(key, raw);
  }
  return [...bySlug.entries()]
    .map(([key, raw]) => ({ platform: key, label: formatPlatformLabel(raw), color: getPlatformColor(raw) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
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
