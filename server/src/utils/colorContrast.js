/**
 * WCAG contrast helpers for the calendar bars (specs/calendar-property-parity.md rules 5-7).
 * Pure: a platform colour is judged against white and the theme ink, the two text colours a bar can carry.
 */
const WHITE = '#FFFFFF';
const INK = '#27251F';
const READABLE_RATIO = 4.5;
const MIN_RATIO_ON_WHITE = 1.4;
const HEX = /^#[0-9a-f]{6}$/i;

const MESSAGES = {
  invalid: 'Couleur invalide.',
  unreadable: 'Couleur peu lisible : choisir plus clair ou plus foncé.',
  tooLight: 'Couleur trop claire pour le calendrier.',
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Whichever of white and ink reads better on `hex`; white wins a tie. */
function textColorFor(hex) {
  return contrastRatio(hex, WHITE) >= contrastRatio(hex, INK) ? WHITE : INK;
}

/** The French refusal message for a colour the calendar cannot print legibly, else null. */
function validateCalendarColor(hex) {
  const value = String(hex || '').trim();
  if (!HEX.test(value)) return MESSAGES.invalid;
  if (Math.max(contrastRatio(value, WHITE), contrastRatio(value, INK)) < READABLE_RATIO) return MESSAGES.unreadable;
  if (contrastRatio(value, WHITE) < MIN_RATIO_ON_WHITE) return MESSAGES.tooLight;
  return null;
}

module.exports = { WHITE, INK, contrastRatio, textColorFor, validateCalendarColor, CALENDAR_COLOR_MESSAGES: MESSAGES };
