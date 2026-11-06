// A GET /api/accounting/synthesis payload for the « Synthèse » / « Encaissements » suites
// (specs/accounting-synthesis.md §4.3). Dates in 2099: a deliberate far future nothing compares with today.

export function synthesisPayload(over = {}) {
  const base = {
    window: { kind: 'quarter', from: '2099-07-01', to: '2099-09-30', label: 'T3 2099', quarter: '2099-Q3', granularity: 'week' },
    today: '2099-11-05',
    fiscalYear: { key: 2099, label: '2099', from: '2099-01-01', to: '2099-12-31' },
    fiscalYears: [{ key: 2099, label: '2099', isCurrent: true }, { key: 2098, label: '2098', isCurrent: false }],
    periodOptions: {
      months: [{ value: '2099-09', label: 'septembre 2099' }, { value: '2099-08', label: 'août 2099' }],
      quarters: [{ value: '2099-Q3', label: 'T3 2099' }, { value: '2099-Q2', label: 'T2 2099' }],
    },
    counts: { payments: 96, entries: 131 },
    comparison: {
      comparable: true, complete: true, months: 3, totalMonths: 3,
      current: { from: '2099-07-01', to: '2099-09-30' }, previous: { from: '2098-07-01', to: '2098-09-30' },
      reasonCode: null, comparableFrom: null, notice: null,
    },
    kpis: {
      revenue: { source: 'stays', ht: 18450.3, ttc: 20295, showHt: true, stays: 41, yoy: { current: 18450.3, previous: 15210.8, change: 21.3 } },
      collected: { source: 'collections', amount: 21980.6, payments: 96, refunds: { count: 1, amount: 120 }, yoy: { current: 21980.6, previous: 17430.2, change: 26.1 } },
      touristTax: { source: 'stays', amount: 286.4, stays: 41, reason: null, yoy: { current: 286.4, previous: 241.9, change: 18.4 } },
      vat: {
        source: 'collections', amount: 1882.7, byRate: [{ ratePercent: 20, vat: 141.67 }, { ratePercent: 10, vat: 1741.03 }],
        mainRate: { ratePercent: 10, vat: 1741.03 }, notSubject: null, yoy: { current: 1882.7, previous: 1490.4, change: 26.3 },
      },
    },
    vatReturn: {
      source: 'collections',
      byRate: [{ ratePercent: 20, base: 708.33, vat: 141.67 }, { ratePercent: 10, base: 17410.3, vat: 1741.03 }],
      byAccount: [
        { account: '70601000', label: 'Activité diverse', ratePercent: 20, base: 708.33, vat: 141.67 },
        { account: '70600000', label: 'Location gîte', ratePercent: 10, base: 16190.1, vat: 1619.01 },
        { account: '70600010', label: 'Prestation complémentaire', ratePercent: 10, base: 1220.2, vat: 122.02 },
      ],
      totals: { base: 18118.63, vat: 1882.7 },
      deductibleOnCommissions: 212.4,
    },
    checks: {
      balanced: { source: 'collections', status: 'ok', totalDebits: 24310.5, totalCredits: 24310.5, unbalanced: [] },
      vatCoherence: {
        source: 'collections', status: 'gap', gap: 0.01,
        entries: [{
          key: 'sale:22281:deposit:2099-08-04:', reservationId: 22281, kind: 'deposit', direction: 'sale', paidDate: '2099-08-04', libelle: 'ANNA LIMA',
          gap: -0.01, rates: [{ ratePercent: 10, base: 117.28, vat: 11.72, expectedVat: 11.73, gap: -0.01 }],
        }],
      },
      settled: { source: 'stays', status: 'gap', count: 1, stays: [{ reservationId: 22290, name: 'Paul Martin', propertyName: 'Gîte', endDate: '2099-09-14', remaining: 412.5 }] },
      lastExport: { at: '2099-10-02T09:14', month: '2099-09', monthLabel: 'septembre 2099' },
    },
    collections: {
      source: 'collections', total: 21980.6, payments: 96,
      byMeans: [
        { key: 'recorded', label: 'Marqué perçu', count: 46, amount: 9020, share: 41, ratio: 0.41 },
        { key: 'platform', label: 'Versements plateforme', count: 29, amount: 7650, share: 34.8, ratio: 0.348 },
        { key: 'paymentLink', label: 'Lien de paiement', count: 21, amount: 5310.6, share: 24.2, ratio: 0.242 },
      ],
      byType: [
        { key: 'balance', label: 'Soldes', count: 33, amount: 8132.8, share: 37, ratio: 0.37 },
        { key: 'platformPayout', label: 'Versements plateforme', count: 29, amount: 7650, share: 34.8, ratio: 0.348 },
        { key: 'deposit', label: 'Acomptes', count: 25, amount: 4397.8, share: 20, ratio: 0.2 },
        { key: 'arrivalComplement', label: 'Compléments à l’arrivée', count: 9, amount: 1800, share: 8.2, ratio: 0.082 },
      ],
      series: {
        granularity: 'week', previousAvailable: true,
        buckets: [
          { key: '2099-07-01', label: 'S27', from: '2099-07-01', to: '2099-07-05', amount: 1520, cumulative: 1520, previousAmount: 1210, previousCumulative: 1210 },
          { key: '2099-07-06', label: 'S28', from: '2099-07-06', to: '2099-07-12', amount: 1830.4, cumulative: 3350.4, previousAmount: 1402, previousCumulative: 2612 },
        ],
      },
    },
  };
  return { ...base, ...over };
}

export const NOT_COMPARABLE = {
  comparable: false, complete: false, months: 0, totalMonths: 3, current: null, previous: null,
  reasonCode: 'noHistory', comparableFrom: null, notice: "Pas de comparaison avec l'an dernier : les données commencent en mars 2099.",
};
