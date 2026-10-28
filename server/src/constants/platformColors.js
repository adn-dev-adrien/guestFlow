// Known booking-platform colours (shared by the platform-colors endpoint and iCal source creation).
// One hue per platform, each readable with white or ink text at 4.5:1 or more
// (specs/calendar-property-parity.md rule 6).
const KNOWN_PLATFORM_COLORS = {
  direct: '#2F5D46',
  airbnb: '#C93848',
  greengo: '#8BC34A',
  abritel: '#4FA3E0',
  abracadaroom: '#8A55B2',
  booking: '#1B3F8B',
  gitedefrance: '#F2CC3D',
  // The accent-stripped slug of the plural "Gîtes de France" (canonical stored form is the plural
  // 'GitesDeFrance' → slug 'gitesdefrance'). Same gold as the singular so the two never drift to grey.
  // Mirrors client/src/constants/platforms.js which carries both spellings.
  gitesdefrance: '#F2CC3D',
  pitchup: '#EF7D22',
};

const DEFAULT_PLATFORM_COLOR = '#6E6A5E';

// The palette before specs/calendar-property-parity.md rule 6. Rows written while it was the built-in one
// (`ical_sources.platformColor` at creation) hold these values: they are the old DEFAULT, never an operator's
// choice, so the boot backfill and the colour listing must not read them as a custom colour.
const LEGACY_PLATFORM_COLORS = {
  direct: '#c9a227',
  airbnb: '#FF5A5F',
  greengo: '#4CAF50',
  abritel: '#1565c0',
  abracadaroom: '#00bcd4',
  booking: '#003580',
  gitedefrance: '#e6c832',
  gitesdefrance: '#e6c832',
  pitchup: '#f57c00',
};
const LEGACY_DEFAULT_PLATFORM_COLOR = '#757575';

/** Whether `color` is a built-in default (current or pre-2026-10-28) for the platform `slug`, not a custom one. */
function isBuiltinColor(slug, color) {
  const value = String(color || '').trim().toLowerCase();
  return [KNOWN_PLATFORM_COLORS[slug], LEGACY_PLATFORM_COLORS[slug], DEFAULT_PLATFORM_COLOR, LEGACY_DEFAULT_PLATFORM_COLOR]
    .some((builtin) => builtin && builtin.toLowerCase() === value);
}

module.exports = { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR, isBuiltinColor };
