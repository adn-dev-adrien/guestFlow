/**
 * The French name of each price type (specs/pricing/pricing-components.md rule 124): what the gift-voucher catalogue shows beside an article and what `outsideSale` quotes in its reason, so
 * every caller reads the same words. They are the words of the option and resource fiches' « Type de prix » menu (`client/src/constants/optionsResourcesTexts.js`), so the reason
 * under « Vendable hors séjour » names the type the operator just picked.
 */
const PRICE_TYPE_LABELS = Object.freeze({
  per_stay: 'Prix fixe',
  free: 'Gratuit',
  per_person: 'Par personne',
  per_night: 'Par jour',
  per_person_per_night: 'Par personne / jour',
  percent_of_stay: '% du montant du séjour',
  per_participant_progressive: 'Dégressif participants',
  per_hour: 'Par heure',
});

module.exports = { PRICE_TYPE_LABELS };
