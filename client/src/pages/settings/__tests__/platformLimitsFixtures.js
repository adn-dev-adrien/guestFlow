// Shared by the Plateformes page suites: the limits GET /api/platforms/settings sends.
export const LIMITS = {
  commissionPercent: { min: 0, max: 99.99, decimals: 2, unit: '%' },
  payoutDueDays: { min: 0, max: 365, integer: true, unit: 'jours', message: 'Un nombre entier de jours (0 à 365).' },
};
