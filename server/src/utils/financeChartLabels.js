// « Revenu par mois » written without hover (specs/finance-dashboard-redesign.md rule 44): which
// month carries its total above its column, on which segment, and the compact French text. Pure.

// A total smaller than this share of the tallest column is left to the tooltip: its label would sit
// on the axis, against its neighbours'.
const LABEL_MIN_SHARE = 0.06;

// « 805 », « 8,2 k », « 12 k » — a value written on a chart mark, unit given by the chart.
function compactAmount(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) < 1000) return String(Math.round(num));
  const k = Math.round(num / 100) / 10;
  return `${String(k).replace('.', ',')} k`;
}

/**
 * @param {Array<{ revenue: number, upcoming: number }>} months
 * @returns the same months with `totalLabel` (string, '' when not written) and `labelOn`
 *   ('upcoming' when the month has some à venir — the top of its stack —, 'past', or null).
 */
function labelRevenueMonths(months) {
  const tallest = Math.max(0, ...months.map((m) => m.revenue));
  return months.map((m) => {
    const labelled = m.revenue > 0 && m.revenue >= tallest * LABEL_MIN_SHARE;
    return {
      ...m,
      totalLabel: labelled ? compactAmount(m.revenue) : '',
      labelOn: labelled ? (m.upcoming > 0 ? 'upcoming' : 'past') : null,
    };
  });
}

module.exports = { labelRevenueMonths, compactAmount, LABEL_MIN_SHARE };
