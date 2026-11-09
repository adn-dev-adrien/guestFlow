// Fixture of the « Profil des séjours » suites (specs/stay-profile.md): a payload shaped as the server
// sends it. Not a test file.
const row = (key, label, count, amount, cp, ap) => ({
  key, label, count, amount, countPercent: cp, amountPercent: ap, countShare: cp / 100, amountShare: ap / 100, countBar: 1, amountBar: 1,
});
const SOURCE = { source: 'stays', sourceLabel: 'Sur les montants des séjours' };

export const PROFILE = {
  window: { kind: 'fy', from: '2026-01-01', to: '2026-12-31', label: 'Exercice 2026', asOf: '2026-11-05' }, // date-literal-ok: a fixture payload, never judged against today
  fiscalYear: { key: 2026, label: '2026', isCurrent: true, previousLabel: '2025' },
  fiscalYears: [{ key: 2026, label: '2026', isCurrent: true }, { key: 2025, label: '2025', isCurrent: false }],
  months: [{ month: '2026-07', label: 'juillet 2026' }], // date-literal-ok: a fixture payload
  propertyId: null,
  properties: [{ id: 1, name: 'Gîte' }, { id: 2, name: 'Tente' }],
  empty: false,
  totals: { count: 4, amount: 2000 },
  dimensions: [
    { key: 'channel', label: 'Canal', ...SOURCE, rows: [row('direct', 'Direct', 1, 1200, 25, 60), row('platform:airbnb', 'Airbnb', 3, 800, 75, 40)] },
    { key: 'length', label: 'Durée', ...SOURCE, rows: [row('n1-2', '1–2 nuits', 3, 800, 75, 40), row('n3-4', '3–4 nuits', 0, 0, 0, 0), row('n5-6', '5–6 nuits', 0, 0, 0, 0), row('n7+', '7 nuits et +', 1, 1200, 25, 60)] },
    { key: 'lead', label: 'Délai', ...SOURCE, rows: [row('d0-6', 'Moins de 7 j', 4, 2000, 100, 100)] },
    { key: 'price', label: 'Tranche de prix', ...SOURCE, rows: [row('p0-299', 'Moins de 300 €', 4, 2000, 100, 100)] },
  ],
  basket: {
    source: 'stays', sourceLabel: 'Sur les montants des séjours, hors taxe de séjour', excludesTouristTax: true,
    currentLabel: '2026', previousLabel: '2025', comparable: true, notice: null,
    rows: [
      { month: '2026-07', label: 'juillet 2026', short: 'juil.', current: { stays: 2, revenue: 1376, average: 688 }, previous: { stays: 2, revenue: 1224, average: 612 }, delta: { amount: 76, change: 12.4, trend: 'up' } }, // date-literal-ok: a fixture payload
      { month: '2026-08', label: 'août 2026', short: 'août', current: { stays: 1, revenue: 500, average: 500 }, previous: null, delta: null }, // date-literal-ok: a fixture payload
    ],
  },
};

export const EMPTY_PROFILE = {
  ...PROFILE,
  empty: true,
  totals: { count: 0, amount: 0 },
  dimensions: PROFILE.dimensions.map((d) => ({ ...d, rows: d.key === 'channel' ? [] : d.rows.map((r) => ({ ...r, count: 0, amount: 0, countPercent: null, amountPercent: null, countShare: null, amountShare: null })) })),
  basket: { ...PROFILE.basket, comparable: false, notice: "Historique depuis avril 2026 : pas encore d'an dernier à comparer.", rows: [] },
};

export function setupMatchMedia() {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
}
