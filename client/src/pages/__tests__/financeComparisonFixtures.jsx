/**
 * Fixtures of the RevPAR / year-over-year suites of FinancePage (specs/finance-revpar-year-over-year.md):
 * the shared dashboard payload with the fields that spec adds. Not a test file.
 */
import { DASHBOARD } from './financePageFixtures';

const metric = (current, previous, change, unit, source = 'stays') => ({ current, previous, change, unit, comparable: true, reason: null, source });
const off = (unit, reason, source = 'stays') => ({ current: null, previous: null, change: null, unit, comparable: false, reason, source });

export const COMPARED = {
  ...DASHBOARD,
  hero: { ...DASHBOARD.hero, revPar: 53.4, openNights: 579, occupiedNights: 184 },
  occupancyAll: {
    average: 0.2,
    months: [
      { month: '2026-06', label: 'juin 2026', initial: 'J', current: 0.25, previous: 0.2 },
      { month: '2026-07', label: 'juillet 2026', initial: 'J', current: 0.4, previous: null },
    ],
  },
  comparison: {
    comparable: true, reason: null, notice: 'Comparaison sur 8 mois sur 12 : les données commencent en mai 2025.',
    months: 8, totalMonths: 12, complete: false, comparableFrom: null,
    current: { from: '2026-05-01', to: '2026-12-31' }, previous: { from: '2025-05-01', to: '2025-12-31' },
    metrics: {
      revenue: metric(3600, 3000, 20, 'percent'),
      collected: metric(3000, 20534, 44.4, 'percent', 'payments'),
      stays: metric(4, 45, 20, 'percent'),
      nights: metric(184, 121, 52.1, 'percent'),
      occupancy: metric(0.32, 0.2094, 10.9, 'points'),
      revenuePerNight: metric(167, 174, -4.3, 'percent'),
      revPar: { ...metric(53.4, 0, null, 'percent'), comparable: false, reason: 'noPreviousValue' },
    },
  },
};

export const NO_HISTORY = {
  ...COMPARED,
  comparison: {
    ...COMPARED.comparison, comparable: false, reason: 'noHistory', months: 0, complete: false, current: null, previous: null,
    notice: "Pas de comparaison avec l'an dernier : les données commencent en janvier 2026.",
    metrics: Object.fromEntries(Object.entries(COMPARED.comparison.metrics).map(([k, m]) => [k, off(m.unit, 'noHistory', m.source)])),
  },
};
