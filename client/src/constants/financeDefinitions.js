// The « i » definitions of the Suivi financier's figures (specs/finance-revpar-year-over-year.md rules
// 15-17). Each one names its source (D-HC8): every figure of this page reads the stays' amounts — « Déjà
// payé » included (specs/finance-dashboard-redesign.md rule 54, D-HC11); « Sur les encaissements » belongs
// to the accounting synthesis.

export const STAYS_SOURCE = 'Sur les montants des séjours';
// Rule 53 (D-HC9) — the basis of « revenu moyen / nuit » and RevPAR, said once.
const NIGHTS_REVENUE = 'revenu des nuits de la période (chaque séjour réparti sur ses nuits, options comprises, hors taxe de séjour)';

export const TILE_DEFINITIONS = {
  collected: `${STAYS_SOURCE} : paiements déjà reçus pour les séjours de la période, nets de commissions, comparés à la même période de l'an dernier.`,
  toCollect: `${STAYS_SOURCE} : reste à payer des séjours terminés, tous exercices.`,
  late: `${STAYS_SOURCE} : acomptes, soldes et versements plateforme passés leur échéance, tous exercices.`,
  stays: `${STAYS_SOURCE} : séjours rattachés à la période.`,
  properties: `${STAYS_SOURCE} : revenu, occupation et RevPAR de chaque logement.`,
  channels: `${STAYS_SOURCE} : commissions des plateformes sur les séjours de la période.`,
};

export const HERO_DEFINITIONS = {
  nights: 'Nuits des séjours de la période, une seule fois par logement et par nuit.',
  occupancy: 'Nuits occupées dans la période ÷ nuits où le logement était ouvert à la réservation (fermetures exclues).',
  revenuePerNight: `${STAYS_SOURCE} : ${NIGHTS_REVENUE} ÷ nuits vendues.`,
  revPar: `${STAYS_SOURCE} : ${NIGHTS_REVENUE} ÷ nuits ouvertes. Monte quand le taux d'occupation monte comme quand les nuits se vendent plus cher.`,
  openNights: 'Nuits de la période moins les fermetures ; « occupées » : celles vendues dans la période.',
};
