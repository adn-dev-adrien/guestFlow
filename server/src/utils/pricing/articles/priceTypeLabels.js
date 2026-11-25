/**
 * The French name of each price type (specs/pricing-components.md rule 124): what the gift-voucher catalogue shows beside an article and what `outsideSale` quotes in its reason, so
 * every caller reads the same words.
 */
const PRICE_TYPE_LABELS = Object.freeze({
  per_stay: 'Forfait',
  free: 'Gratuit',
  per_person: 'Par personne',
  per_night: 'Par nuit',
  per_person_per_night: 'Par personne et par nuit',
  percent_of_stay: 'Pourcentage du séjour',
  per_participant_progressive: 'Progressif par participant',
  per_hour: 'À l’heure',
});

module.exports = { PRICE_TYPE_LABELS };
