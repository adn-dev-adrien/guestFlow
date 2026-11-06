// Fixture data of the report grammar (specs/report-grammar.md): the dev-only preview page and the
// component tests read the same figures. Fake numbers, shaped like the server payloads lots 1–5 send —
// every total, share and delta is written here as the server would send it, never computed.

export const KPI_TILES = [
  { key: 'ca', label: 'CA HT', info: "Chiffre d'affaires hors taxes des séjours terminés sur la période, net des remises.", value: '18 450 €', caption: 'TTC : 20 295 €', comparison: { change: 21.3, previous: '15 210 €' } },
  { key: 'cash', label: 'Encaissé', info: 'Somme des paiements reçus sur la période, quel que soit le mois du séjour.', value: '21 981 €', caption: '96 paiements', comparison: { change: 26.1, previous: '17 430 €' } },
  { key: 'occ', label: "Taux d'occupation", info: 'Nuits vendues ÷ nuits où le logement était ouvert à la réservation.', value: '58,2 %', caption: '165 nuits vendues', comparison: { change: 3.1, previous: '55,1 %', unit: 'points' } },
  { key: 'revpar', label: 'RevPAR', info: 'Revenu des nuits ÷ nuits disponibles.', value: '161 €', caption: 'prix moyen : 277 €/nuit', comparison: { change: -2.4, previous: '165 €' } },
];

export const NO_COMPARISON_TEXT = "Aucun séjour sur la même période de l'exercice précédent : pas de comparaison avec l'an dernier.";

export const TABS = [
  { value: 'cash', label: 'Encaissements', count: 40 },
  { value: 'stays', label: 'Séjours', count: 12 },
  { value: 'vat', label: 'TVA', count: 3 },
];

export const EXERCISE_MONTHS = ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.']
  .map((label, i) => ({ key: `m${i + 1}`, label }));

export const TREND_SERIES = [
  { key: 'y2026', name: '2026-27', area: true, values: [2410, 4900, null, null, null, null, null, null, null, null, null, null] },
  { key: 'y2025', name: '2025-26', values: [1980, 4120, 6050, 7310, 9020, 12480, 16900, 21950, 27400, 33800, 39950, 43105] },
  { key: 'y2024', name: '2024-25', hidden: true, values: [1520, 3360, 4980, 6110, 7400, 10050, 14020, 18300, 23100, 28700, 34900, 38020] },
  { key: 'y2023', name: '2023-24', hidden: true, values: [1310, 2840, 4210, 5160, 6230, 8420, 11800, 15400, 19500, 24200, 29100, 31400] },
];

export const SHARE_ROWS = [
  { key: 'transfer', label: 'Virement', quantity: 38, amount: 8420, share: 0.383 },
  { key: 'platforms', label: 'Plateformes', quantity: 29, amount: 7650, share: 0.348 },
  { key: 'link', label: 'Lien de paiement', quantity: 21, amount: 5310.6, share: 0.242 },
  { key: 'cheque', label: 'Chèque', quantity: 3, amount: 380, share: 0.017 },
  { key: 'cash', label: 'Espèces', quantity: 5, amount: 220, share: 0.01 },
];
export const SHARE_TOTAL = { quantity: 96, amount: 21980.6 };

export const DAYS = Array.from({ length: 31 }, (_, i) => ({ key: `2026-10-${String(i + 1).padStart(2, '0')}`, label: `${i + 1}/10` }));
export const DAILY = [163, 335, 314, 0, 0, 109, 1, 0, 0, 0, 0, 0, 0, 180, 0, 1, 1, 0, 4, 0, 266, 0, 63, 3, 132, 286, 0, 0, 0, 0, 0];
export const CUMULATIVE = [163, 498, 812, 812, 812, 921, 922, 922, 922, 922, 922, 922, 922, 1102, 1102, 1103, 1104, 1104, 1108, 1108, 1374, 1374, 1437, 1440, 1572, 1858, 1858, 1858, 1858, 1858, 1858];
export const PREVIOUS_CUMULATIVE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 28, 29, 29, 29, 29, 91, 108, 108, 108, 223, 223, 223, 223, 223, 223, 225, 429, 429, 429, 429, 429, 429];

// A rate on a fixed 0–100 % axis, with long series names (rules 21, 22, 27).
export const OCCUPANCY_SERIES = [
  { key: 'cur', name: 'Exercice 2026-2027', area: true, values: [0.146, 0.161, 0.09, 0.05, null, null, null, null, null, null, null, null] },
  { key: 'prev', name: 'Exercice 2025-2026', dashed: true, values: [0.12, 0.14, 0.1, 0.04, 0.06, 0.11, 0.22, 0.31, 0.48, 0.71, 0.83, 0.37] },
];
export const EMPTY_TEXT = 'Aucun encaissement sur la période.';
