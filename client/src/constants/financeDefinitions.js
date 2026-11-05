// The « i » definitions of the Suivi financier's figures (specs/finance-revpar-year-over-year.md rules
// 15-17). Each one names its source (D-HC8): « Sur les montants des séjours » or « Sur les encaissements ».

export const STAYS_SOURCE = 'Sur les montants des séjours';
export const PAYMENTS_SOURCE = 'Sur les encaissements';

export const TILE_DEFINITIONS = {
  collected: `${PAYMENTS_SOURCE} : paiements reçus pour les séjours de la période, nets de commissions. L'an dernier : ce qui était reçu à la même date.`,
  toCollect: `${STAYS_SOURCE} : reste à payer des séjours terminés, tous exercices.`,
  late: `${STAYS_SOURCE} : acomptes, soldes et versements plateforme passés leur échéance, tous exercices.`,
  stays: `${STAYS_SOURCE} : séjours rattachés à la période.`,
  properties: `${STAYS_SOURCE} : revenu, occupation et RevPAR de chaque logement.`,
  channels: `${STAYS_SOURCE} : commissions des plateformes sur les séjours de la période.`,
};

export const HERO_DEFINITIONS = {
  nights: 'Nuits des séjours de la période, une seule fois par logement et par nuit.',
  occupancy: 'Nuits vendues ÷ nuits où le logement était ouvert à la réservation (fermetures exclues).',
  revenuePerNight: `${STAYS_SOURCE} : revenu ÷ nuits vendues, options comprises.`,
  revPar: `${STAYS_SOURCE} : revenu ÷ nuits ouvertes. Monte quand le taux d'occupation monte comme quand les nuits se vendent plus cher.`,
  openNights: 'Nuits de la période moins les fermetures.',
};
