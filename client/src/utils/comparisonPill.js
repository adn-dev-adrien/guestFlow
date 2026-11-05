/**
 * comparisonPill — turns one `dashboard.comparison.metrics.<key>` (specs/finance-revpar-year-over-year.md
 * rules 8-10) into the props of the year-over-year pill (`SelectableTile.comparison`,
 * `YearOverYearBadge` report mode). Presentational only: the change, its unit and whether it compares
 * come from the server; this formats last year's value and maps « not comparable » to change null
 * (« — vs N-1 »). Without a metric (an older payload) there is no pill.
 *
 * @param {object|undefined} metric          { current, previous, change, unit, comparable }
 * @param {(v: number) => string} formatPrevious
 * @returns {{ change: number|null, previous?: string, unit: string } | undefined}
 */
export function comparisonPill(metric, formatPrevious) {
  if (!metric) return undefined;
  if (!metric.comparable) return { change: null, unit: metric.unit };
  return { change: metric.change, previous: metric.previous == null ? undefined : formatPrevious(metric.previous), unit: metric.unit };
}

/** A rate with one decimal, « 55,1 % », the grammar's pill format. */
export const rateOneDecimal = (x) => `${(Math.round(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
