// French copy of the « Synthèse » and « Encaissements » tabs (specs/accounting-synthesis.md §6). Impersonal,
// short. Every figure comes from the server; this file only names things.

export const TABS = { synthese: 'Synthèse', encaissements: 'Encaissements', ecritures: 'Écritures' };

export const PERIOD_KINDS = [
  { value: 'month', label: 'Mois' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'fy', label: 'Exercice' },
  { value: 'custom', label: 'Personnalisée' },
];

// D-HC8 — each figure says what it is computed on.
export const SOURCE_CAPTIONS = {
  stays: 'Sur les montants des séjours',
  collections: 'Sur les encaissements',
};

export const KPI = {
  revenue: {
    label: 'CA HT',
    info: 'Chiffre d’affaires hors taxes des séjours de la période, attribués comme dans le Suivi financier.',
  },
  collected: {
    label: 'Encaissé',
    info: 'Paiements reçus sur la période, quel que soit le mois du séjour, hors caisse interne. Même total que le journal comptable.',
  },
  touristTax: {
    label: 'Taxe de séjour',
    info: 'Taxe à reverser à la commune pour les séjours de la période. La taxe qu’une plateforme reverse elle-même n’y figure pas.',
  },
  vat: {
    label: 'TVA à déclarer',
    info: 'TVA collectée sur les encaissements de la période, par taux : le montant à reporter sur la déclaration.',
  },
};

export const CHECKS = {
  balanced: 'Écritures équilibrées',
  vatCoherence: 'TVA cohérente',
  settled: 'Séjours terminés soldés',
  lastExport: 'Dernier export CSV',
};

export const VAT_PANEL = {
  label: 'Récapitulatif TVA à déclarer',
  byRate: 'Par taux',
  byAccount: 'Par compte',
  note: 'TVA exigible à l’encaissement : les sommes encaissées sur la période, pas les séjours facturés.',
  deductible: 'TVA déductible sur les commissions, non déduite ici',
};

export const GRANULARITY = {
  day: { panel: 'Encaissements journaliers et cumul', daily: 'Encaissé du jour', header: 'Jour' },
  week: { panel: 'Encaissements hebdomadaires et cumul', daily: 'Encaissé de la semaine', header: 'Semaine' },
  month: { panel: 'Encaissements mensuels et cumul', daily: 'Encaissé du mois', header: 'Mois' },
};

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
export const payments = (n) => plural(n, 'paiement', 'paiements');
export const stays = (n) => plural(n, 'séjour', 'séjours');
export const entries = (n) => plural(n, 'écriture', 'écritures');

/** « 12 k€ » on a chart axis; under 1 000 the amount itself. */
export const axisEuro = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} k€` : `${Math.round(v)} €`);
