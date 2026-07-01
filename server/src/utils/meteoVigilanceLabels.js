/**
 * Météo-France Vigilance — static label & instruction maps (specs/checkin-weather-alerts.md §4.1).
 *
 * Pure, side-effect-free lookups used to turn the numeric ids of the DPVigilance API into
 * French display strings and to append phenomenon-specific safety instructions on top of the
 * official summary. Kept separate from meteoVigilance.js so the maps are trivially unit-tested.
 */

// Phenomenon id → French label. Ids per the DPVigilance API (1..9).
const PHENOMENON_LABELS = Object.freeze({
  1: 'Vent violent',
  2: 'Pluie-inondation',
  3: 'Orages',
  4: 'Crues',
  5: 'Neige-verglas',
  6: 'Canicule',
  7: 'Grand froid',
  8: 'Avalanches',
  9: 'Vagues-submersion',
});

// Colour id/level → French label. 1=green, 2=yellow, 3=orange, 4=red.
const COLOR_LABELS = Object.freeze({
  1: 'Vert',
  2: 'Jaune',
  3: 'Orange',
  4: 'Rouge',
});

// Phenomenon-specific safety instructions appended after the official summary (rule 7). The orage
// timing sentence is built dynamically in meteoVigilance.buildAlertDisplay (it needs the dates); the
// static advisories live here.
const PHENOMENON_INSTRUCTIONS = Object.freeze({
  // Canicule — the two mandated lines (rule 7) + a hydration reminder.
  6: Object.freeze([
    'Les feux sont strictement interdits (barbecue, cigarette, etc.).',
    'Merci de respecter impérativement les zones fumeurs.',
    'Pensez à vous hydrater régulièrement et à rester au frais aux heures les plus chaudes.',
  ]),
  // Orages.
  3: Object.freeze([
    'Évitez les activités extérieures et les zones exposées pendant l’épisode orageux.',
  ]),
  // Vent violent.
  1: Object.freeze([
    'Limitez vos déplacements et rangez ou fixez les objets exposés au vent.',
  ]),
});

// Fallback advisory for any phenomenon without a specific list.
const GENERIC_INSTRUCTION = 'Soyez prudents et suivez les consignes de sécurité pendant toute la durée de l’épisode.';

function phenomenonLabel(id) {
  return PHENOMENON_LABELS[Number(id)] || 'Phénomène météo';
}

function colorLabel(level) {
  return COLOR_LABELS[Number(level)] || '';
}

// Static instructions for a phenomenon (never empty — falls back to the generic advisory).
function staticInstructionsFor(phenomenonId) {
  const specific = PHENOMENON_INSTRUCTIONS[Number(phenomenonId)];
  return specific ? [...specific] : [GENERIC_INSTRUCTION];
}

module.exports = {
  PHENOMENON_LABELS,
  COLOR_LABELS,
  PHENOMENON_INSTRUCTIONS,
  GENERIC_INSTRUCTION,
  phenomenonLabel,
  colorLabel,
  staticInstructionsFor,
};
