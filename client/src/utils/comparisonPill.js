import { formatCurrency, formatCurrencyRounded } from './formatters';

/**
 * comparisonPill — turns one `dashboard.comparison.metrics.<key>` (specs/finance-revpar-year-over-year.md
 * rules 8-10) into the props of the year-over-year pill (`SelectableTile.comparison`,
 * `YearOverYearBadge` report mode). Presentational only: the change, its unit and whether it compares
 * come from the server; this formats last year's value and maps « not comparable » to change null
 * (« — vs N-1 »). Without a metric (an older payload) there is no pill.
 *
 * Rule 27 (D-HC14) — the pill stays short even on a partial comparison: the span is said once, by the
 * notice under the hero (« Comparé à l'an dernier sur N mois … »), never in each pill.
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

/**
 * Rule 24 — an amount per night: to the cent under 100 €, so that « 5,26 € » and « 5,62 € » never both read
 * « 5 € » beside a −6,4 % change; whole euros above.
 */
export const perNightAmount = (v) => (Math.abs(v) < 100 ? formatCurrency(v) : formatCurrencyRounded(v));

/** A rate with one decimal, « 55,1 % », the grammar's pill format. */
export const rateOneDecimal = (x) => `${(Math.round(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
