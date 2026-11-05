// The « À vérifier » payload of specs/finance-data-checks.md §4.3, shared by the panel's suites.
export const CHECKS = [
  {
    key: 'tourist-tax-missing', severity: 'fix', label: 'Séjours terminés sans taxe de séjour alors qu’elle est à reverser',
    hint: 'La fiche porte 0 € de taxe, mais le calcul du logement en donne une.', count: 2, moreCount: 0,
    items: [
      { reservationId: 412, label: '202609011 · Marie Martin · Granja · 26/09 → 28/09', detail: 'Taxe calculée : 4,80 €' },
      { reservationId: 413, label: '202610004 · Estiva · 10/10 → 11/10', detail: 'Taxe calculée : 2,40 €' },
    ],
  },
  {
    key: 'tourist-tax-undeclared', severity: 'fix', label: 'Mois passés dont la taxe n’est pas entièrement déclarée',
    hint: 'Des séjours déclarables du mois ne sont pas cochés « Déclarée ».', count: 1, moreCount: 0,
    items: [{ month: '2026-09', label: 'Septembre 2026', detail: 'Reste 18,15 € à déclarer · 2 séjours', amount: 18.15, stays: 2 }],
  },
  {
    key: 'platform-payment-missing', severity: 'check', label: 'Séjours plateforme terminés sans « Paiement plateforme »',
    hint: 'Le montant payé par le client n’est pas saisi : le total vient du tarif.', count: 0, moreCount: 0, items: [],
  },
  {
    key: 'guest-name-missing', severity: 'check', label: 'Séjours terminés sans nom de voyageur',
    hint: 'Le client est resté celui créé par l’import du calendrier.', count: 23, moreCount: 22,
    items: [{ reservationId: 377, label: '202608013 · Granja · 10/08 → 12/08', detail: 'Client : Ical Booking' }],
  },
];

export const PAYLOAD = {
  // date-literal-ok: a server payload echoed as is; the panel renders it and never compares it with today
  exercise: { key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31' }, propertyId: null, asOf: '2026-11-05', pendingCount: 3, checks: CHECKS,
};

export const EMPTY_PAYLOAD = { ...PAYLOAD, pendingCount: 0, checks: CHECKS.map((c) => ({ ...c, count: 0, moreCount: 0, items: [] })) };
