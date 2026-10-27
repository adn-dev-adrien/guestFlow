/**
 * The three questions of the start assistant's plugin step (specs/plugins-phase-p-productisation.md
 * rule 43; UI/UX review 2026-10-18, proposal 13). The owner answers what the business does; the
 * server turns each « oui » into its plugins. The full list stays in Paramètres › Plugins.
 *
 * `recommended`: answered « oui » on a fresh instance (what rule 36 used to pre-tick).
 */

const {
  HOURLY_RESOURCES, LINEN, SAS, WEBSITE_BOOKING, ONLINE_PAYMENT,
} = require('./plugins');

const ONBOARDING_QUESTIONS = Object.freeze([
  {
    id: 'options',
    label: 'Des options payantes à l’arrivée : repas, linge, sauna ou spa ?',
    // The arrival SAS is where the options are sold and paid.
    plugins: [HOURLY_RESOURCES, LINEN, SAS],
    recommended: true,
  },
  {
    id: 'website',
    label: 'Un site internet qui prend des réservations ?',
    plugins: [WEBSITE_BOOKING],
    recommended: true,
  },
  {
    id: 'payment',
    label: 'Encaisser en ligne, par lien de paiement ?',
    plugins: [ONLINE_PAYMENT],
    recommended: false,
  },
]);

module.exports = { ONBOARDING_QUESTIONS };
