/**
 * French labels shared by the three "extras" renderers of the reservation form — catalogue options
 * (`OptionRow`), custom lines and resources (`ExtrasSection`).
 *
 * They live in their own module rather than in `ExtrasSection.js` so `OptionRow` can import them
 * without creating a cycle (ExtrasSection → OptionRow → ExtrasSection).
 */

// Tooltip text shared by every "Compl." toggle (specs/force-item-to-complement.md §6.4).
export const COMPLEMENT_TOOLTIP = 'Cette ligne sera comptabilisée intégralement dans le Complément à percevoir, jamais dans l\'acompte ou le solde.';

export const PRICE_TYPE_LABELS = {
  per_stay: 'prix fixe',
  per_person: 'par pers.',
  per_night: 'par jour',
  per_person_per_night: 'par pers./jour',
  per_hour: 'par heure',
  free: 'gratuit',
};
