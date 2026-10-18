/**
 * Shared fixtures of the FinancePage suites: the payloads of `/finance/dashboard` and of its `toCollect`
 * detail, as the server sends them. Not a test file.
 */

const month = (m, label, initial, revenue) => ({
  month: m, label, initial, past: revenue, upcoming: 0, revenue, revenueHt: revenue / 1.1, nights: 3,
  previous: null, previousLabel: label.replace('2026', '2025'), inWindow: true,
});
export const MONTHS = [month('2026-06', 'juin 2026', 'J', 1200), month('2026-07', 'juillet 2026', 'J', 2400)];

export const DASHBOARD = {
  window: { kind: 'fy', from: '2026-01-01', to: '2026-12-31', label: 'Exercice 2026', asOf: '2026-09-29' },
  fiscalYear: { key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true, previousLabel: '2025' },
  fiscalYears: [{ key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true }],
  months: MONTHS.map(({ month: m, label }) => ({ month: m, label })),
  propertyId: null,
  hero: {
    revenue: 3600, revenueHt: 3272.73, stays: 4, nights: 6, occupancy: 0.2, revenuePerNight: 600, directShare: 0.5,
    yoy: null, goal: null,
    cumulative: [{ day: '2026-06-01', x: 0, current: 0, previous: null }, { day: '2026-07-31', x: 60, current: 3600, previous: null }],
    axis: [{ x: 0, label: 'juin' }, { x: 30, label: 'juil.' }],
  },
  insights: [{ key: 'late', tone: 'info', title: 'Aucun paiement en retard', text: 'Tout est à jour.' }],
  properties: [
    { propertyId: 1, name: 'Gîte', color: '#2F5D46', revenue: 2400, occupancy: 0.3, revenuePerNight: 600 },
    { propertyId: 2, name: 'Tente', color: '#C99038', revenue: 1200, occupancy: 0.1, revenuePerNight: 600 },
  ],
  totalRevenue: 3600,
  totalOccupancy: 0.2,
  tiles: {
    collected: { amount: 3000, shareOfRevenue: 0.8333 },
    toCollect: { amount: 300, stays: 1 },
    late: { amount: 0, stays: 0 },
    stays: { count: 4, upcoming: 1 },
    properties: { count: 2, leader: 'Gîte' },
    channels: { commission: 120 },
  },
  revenueMonths: MONTHS,
  occupancy: [1, 2].map((id) => ({
    propertyId: id, name: id === 1 ? 'Gîte' : 'Tente', color: '#2F5D46', average: 0.2,
    months: MONTHS.map((m) => ({ month: m.month, label: m.label, initial: m.initial, current: 0.2, previous: null })),
  })),
};

export const PENDING_ROW = {
  id: 42, firstName: 'Marie', lastName: 'Martin', propertyName: 'Tente', platform: 'direct',
  startDate: '2026-05-01', endDate: '2026-05-04', totalSejour: 300, settled: false,
  remainingToPay: 300, remainingDue: 300, depositAmount: 100, depositPaid: 0, depositDisabled: 0,
  balanceAmount: 200, balancePaid: 0, complementAmount: 0, endOfStayComplementAmount: 0,
};
export const TO_COLLECT = {
  rows: [PENDING_ROW],
  totals: { depositAmount: 100, balanceAmount: 200, complementAmount: 0, endOfStayComplementAmount: 0, remainingToPay: 300, remainingDue: 300, totalSejour: 300 },
  projection: { total: 1500, collected: 900, pending: 600 },
};

