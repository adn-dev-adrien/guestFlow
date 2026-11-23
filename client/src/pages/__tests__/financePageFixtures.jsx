/**
 * Shared fixtures of the FinancePage suites: the payloads of `/finance/dashboard` and of its `toCollect`
 * detail, as the server sends them. Not a test file.
 */

const month = (m, label, initial, revenue) => ({
  month: m, label, initial, past: revenue, upcoming: 0, revenue, revenueHt: revenue / 1.1, nights: 3,
  previous: null, previousLabel: label.replace('2026', '2025'), inWindow: true,
});
export const MONTHS = [month('2026-06', 'juin 2026', 'J', 1200), month('2026-07', 'juillet 2026', 'J', 2400)];

// The server's `cashProjection` (specs/mobile-dashboard-exercise-cash.md rule 18): two months, the first received, the second expected.
const point = (date, label, x, over) => ({ date, label, x, received: 0, expected: 0, cumulative: 0, receivedCumulative: 0, expectedCumulative: 0, solid: null, dashed: null, ...over });
export const CASH_PROJECTION = {
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  today: '2026-06-15', todayLabel: '15 juin 2026', todayMonth: '2026-06', todayX: 14, from: '2026-06-01', to: '2026-07-31', end: '2026-07-31', endLabel: '31 juillet 2026', endCaption: 'À la fin de l\'exercice',
  xMax: 61, total: 3600, empty: false, lateAmount: 0,
  months: [
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    { key: '2026-06', label: 'juin', title: 'juin 2026', x: 0, end: '2026-06-30', received: 3000, late: 0, upcoming: 0, expected: 0, inWindow: true, cumulative: 3000 },
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    { key: '2026-07', label: 'juil.', title: 'juillet 2026', x: 30, end: '2026-07-31', received: 0, late: 0, upcoming: 600, expected: 600, inWindow: true, cumulative: 3600 },
  ],
  daily: [
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    point('2026-06-01', '1 juin 2026', 0, { solid: 0, cumulative: 0 }),
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    point('2026-06-10', '10 juin 2026', 9, { received: 3000, cumulative: 3000, receivedCumulative: 3000, solid: 3000 }),
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    point('2026-06-15', '15 juin 2026', 14, { cumulative: 3000, receivedCumulative: 3000, solid: 3000, dashed: 3000 }),
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    point('2026-07-05', '5 juil. 2026', 34, { expected: 600, cumulative: 3600, receivedCumulative: 3000, expectedCumulative: 600, dashed: 3600 }),
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    point('2026-07-31', '31 juil. 2026', 60, { cumulative: 3600, receivedCumulative: 3000, expectedCumulative: 600, dashed: 3600 }),
  ],
};

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
    { propertyId: 1, name: 'Gîte', colorIndex: 0, revenue: 2400, occupancy: 0.3, revenuePerNight: 600 },
    { propertyId: 2, name: 'Tente', colorIndex: 1, revenue: 1200, occupancy: 0.1, revenuePerNight: 600 },
  ],
  totalRevenue: 3600,
  totalOccupancy: 0.2,
  tiles: {
    collected: { amount: 3000, shareOfRevenue: 0.8333 },
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    toCollect: { amount: 300, payments: 2, nextDate: '2026-10-05', nextDateLabel: '5 oct. 2026', late: { amount: 0, payments: 0 } },
    late: { amount: 0, stays: 0 },
    stays: { count: 4, upcoming: 1 },
    properties: { count: 2, leader: 'Gîte' },
    channels: { commission: 120 },
  },
  cashProjection: CASH_PROJECTION,
  revenueMonths: MONTHS,
  occupancy: [1, 2].map((id) => ({
    propertyId: id, name: id === 1 ? 'Gîte' : 'Tente', colorIndex: id - 1, average: 0.2,
    months: MONTHS.map((m) => ({ month: m.month, label: m.label, initial: m.initial, current: 0.2, previous: null })),
  })),
};

export const TO_COLLECT = {
  groups: [{
    key: '2026-07', label: 'Juillet 2026', total: 300,
    // date-literal-ok: a server payload the component renders as given; nothing compares it with today
    rows: [{ reservationId: 42, date: '2026-07-05', dateLabel: '5 juil. 2026', kind: 'balance', label: 'Solde', clientName: 'Marie Martin', propertyName: 'Tente', platform: 'direct', amount: 300, late: false }],
  }],
  // date-literal-ok: a server payload the component renders as given; nothing compares it with today
  rows: [{ reservationId: 42, date: '2026-07-05', dateLabel: '5 juil. 2026', kind: 'balance', label: 'Solde', clientName: 'Marie Martin', propertyName: 'Tente', platform: 'direct', amount: 300, late: false }],
  totals: { amount: 300, payments: 1 },
};
