// Shared by the property page suites: the limits the server sends (GET /api/properties/limits).
export const LIMITS = {
  depositDueDays: { min: 0, max: 30, integer: true, unit: 'jours' },
  balanceDaysBefore: { min: 0, max: 60, integer: true, unit: 'jours' },
  cancelAfterBalanceDueDays: { min: 0, max: 60, integer: true, unit: 'jours' },
  depositPercent: { min: 1, max: 99, decimals: 2, unit: '%', message: "Entre 1 et 99 %. Pour tout encaisser à la réservation, désactivez l'acompte." },
};
