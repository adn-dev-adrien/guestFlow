/**
 * The English GuestFlow ships with (specs/translation-catalogue.md §5).
 *
 * The system options — the ones a fresh install creates by itself — used to carry their English in
 * the seed that created them, written straight into `options.titleEn`. With that column gone, the
 * defaults live here instead and are copied into the catalogue once, where the operator can then
 * change them like any other.
 *
 * Matched on the FRENCH text rather than on an id, because these rows are created by the seeds on
 * every install and their ids differ from one database to the next.
 *
 * Operator data always wins: the migration copies the existing columns first, and these defaults only
 * ever fill what is still empty.
 */

const DEFAULT_TRANSLATIONS = Object.freeze([
  { kind: 'option.title', fr: 'Arrivée anticipée', en: 'Early check-in' },
  { kind: 'option.title', fr: 'Départ tardif', en: 'Late check-out' },
  { kind: 'option.title', fr: 'Ménage', en: 'Cleaning' },
  { kind: 'option.title', fr: 'Linge de lit', en: 'Bed linen' },
  { kind: 'option.title', fr: 'Linge de toilette', en: 'Bathroom linen' },
  { kind: 'option.title', fr: 'Tapis de bain', en: 'Bath mat' },
  { kind: 'option.title', fr: 'Petit déjeuner', en: 'Breakfast' },
  { kind: 'option.title', fr: 'Lit bébé', en: 'Baby cot' },
  { kind: 'option.title', fr: 'Assurance annulation', en: 'Cancellation insurance' },
  // The resource of the same French name is a cot you sleep in, not the supplement you pay for it.
  { kind: 'resource.name', fr: 'Lit bébé', en: 'Baby bed' },
]);

module.exports = { DEFAULT_TRANSLATIONS };
