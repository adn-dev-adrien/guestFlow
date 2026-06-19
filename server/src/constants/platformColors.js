// Known booking-platform colours (shared by the platform-colors endpoint and iCal source creation).
const KNOWN_PLATFORM_COLORS = {
  direct: '#c9a227',
  airbnb: '#FF5A5F',
  greengo: '#4CAF50',
  abritel: '#1565c0',
  abracadaroom: '#00bcd4',
  booking: '#003580',
  gitedefrance: '#e6c832',
  // The accent-stripped slug of the plural "Gîtes de France" (canonical stored form is the plural
  // 'GitesDeFrance' → slug 'gitesdefrance'). Same gold as the singular so the two never drift to grey.
  // Mirrors client/src/constants/platforms.js which carries both spellings.
  gitesdefrance: '#e6c832',
  pitchup: '#f57c00',
};

const DEFAULT_PLATFORM_COLOR = '#757575';

module.exports = { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR };
