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

module.exports = { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR };
