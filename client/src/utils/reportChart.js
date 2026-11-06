// Pure helpers of the report charts (specs/report-grammar.md): layout and export only. They never
// compute a figure — every value, share and total arrives from the server.

/** Index of the last non-null value of a series, -1 when it has none. */
export function lastValueIndex(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] != null) return i;
  return -1;
}

/**
 * The name written at the end of each line (rules 8, 22): sorted top to bottom, each label pushed down
 * until it clears the one above by `minGap` pixels, all of them kept between `bounds.top` and
 * `bounds.bottom` when given.
 * @param {Array<{ key: string, y: number }>} ends  pixel y of each series' last point
 * @returns {Array<{ key: string, y: number, labelY: number }>}
 */
export function layoutEndLabels(ends, minGap = 14, offset = 4, bounds = {}) {
  const top = bounds.top ?? -Infinity;
  const bottom = bounds.bottom ?? Infinity;
  let last = -Infinity;
  const out = [...ends].sort((a, b) => a.y - b.y).map((e) => {
    const labelY = Math.max(e.y + offset, last + minGap, top);
    last = labelY;
    return { ...e, labelY };
  });
  // Rule 22 — kept inside the plot: a name past the bottom (a line ending on 0) climbs back above the
  // axis labels, and pushes the names above it up by the same gap.
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const ceiling = i === out.length - 1 ? bottom : out[i + 1].labelY - minGap;
    out[i].labelY = Math.max(top, Math.min(out[i].labelY, ceiling));
  }
  return out;
}

/** Recharts `interval` so that a narrow screen shows about 4 ticks and a wide one about 7 (rule 12). */
export function tickInterval(count, narrow) {
  return Math.max(0, Math.ceil(count / (narrow ? 4 : 7)) - 1);
}

/** Recharts rows from categories and aligned value arrays: `{ key, label, [seriesKey]: value }`. */
export function rowsFromSeries(categories, series) {
  return categories.map((c, i) => {
    const row = { key: c.key, label: c.label };
    series.forEach((s) => { row[s.key] = s.values[i] == null ? null : s.values[i]; });
    return row;
  });
}

const csvCell = (v) => {
  if (v == null) return '';
  const text = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * « Copier les données » (rule 10): semicolon-separated, decimal comma (what a French spreadsheet
 * pastes into columns), raw numbers rather than formatted text, an empty cell for a missing value.
 */
export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

/** The « nice » step just above `raw`: 1, 2, 2.5 or 5 times a power of ten (rule 21). */
export function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power;
}

const clean = (x) => Number(x.toPrecision(12));

/**
 * Y ticks of a report chart (rule 21). With a fixed domain (`[0, 1]` for a rate): five even ticks
 * across it. Otherwise ticks on nice steps from 0 (or below, for a negative value) to just above the
 * largest value, about `count` intervals — never « 0 / 4,5 / 9 / 13,5 ».
 * @returns {{ domain: [number, number], ticks: number[] }}
 */
export function axisTicks(values, { domain, count = 4 } = {}) {
  if (domain) {
    const [a, b] = domain;
    return { domain: [a, b], ticks: Array.from({ length: 5 }, (_, i) => clean(a + (i * (b - a)) / 4)) };
  }
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  // Rules 34, 38 — the outer ticks hug both the largest and the smallest value: of `count`,
  // `count + 1` and `count + 2` intervals, the first whose empty room above the max and below the min
  // is at most a quarter of the axis (else the tightest). Steps are multiples from 0, so 0 stays a
  // tick whenever the range crosses it, and each end is at most one step beyond its value.
  let best = null;
  for (let c = count; c <= count + 2; c += 1) {
    const step = niceStep((hi - lo) / c || 1 / c);
    const start = clean(Math.floor(lo / step) * step);
    const end = clean(Math.max(Math.ceil(hi / step) * step, start + step));
    const waste = ((end - hi) + (lo - start)) / (end - start);
    if (!best || waste < best.waste) best = { step, start, end, waste };
    if (waste <= 0.25) { best = { step, start, end, waste }; break; }
  }
  const { step, start, end } = best;
  const ticks = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(clean(t));
  return { domain: [start, end], ticks };
}

/** Width a series name takes at the end of a line (11.5 px, semibold), with its dot and gap (rule 22). */
export const endLabelWidth = (name) => Math.ceil(String(name).length * 7) + 16;

/** A name cut to `maxWidth` with « … » (the full name stays in the SVG `<title>`). */
export function fitEndLabel(name, maxWidth) {
  const text = String(name);
  if (endLabelWidth(text) <= maxWidth) return text;
  const chars = Math.max(1, Math.floor((maxWidth - 16) / 7) - 1);
  return `${text.slice(0, chars)}…`;
}

/** The right margin that holds the longest end name, between 40 px and `cap`. */
export function endLabelMargin(names, cap) {
  return Math.min(cap, Math.max(40, ...names.map(endLabelWidth)));
}

/**
 * Recharts `interval` of the category axis (rules 12, 26, 35): every Nth label from the first, evenly
 * spaced. N is at least the regular thinning of `tickInterval`, and large enough that the longest label
 * fits its slot of the measured plot width. Unmeasured (first paint, tests): long labels let Recharts
 * pick the same evenly spaced N from their measured text (`equidistantPreserveStart`). `thin: false`
 * drops the rule-12 floor: every label that fits is shown (the hero's months, rule 40).
 */
export function xInterval(categories, narrow, plotWidth, { thin = true } = {}) {
  const longest = Math.max(0, ...categories.map((c) => String(c.label ?? '').length));
  const regular = thin ? tickInterval(categories.length, narrow) : 0;
  if (plotWidth > 0) {
    const perLabel = longest * 6.5 + 12;
    const fit = Math.max(1, Math.floor(plotWidth / perLabel));
    return Math.max(regular, Math.ceil(categories.length / fit) - 1);
  }
  return longest > 5 ? 'equidistantPreserveStart' : regular;
}

/**
 * The end names' margin cap (rules 22, 39): 150 px (96 on a phone), and never more than 40 % of the
 * chart so the plot keeps at least 60 %. It only grows with the chart's width: a name that fits a
 * narrow chart is never cut on a wider one.
 */
export function endLabelCap(narrow, chartWidth) {
  const cap = narrow ? 96 : 150;
  return chartWidth > 0 ? Math.min(cap, Math.round(chartWidth * 0.4)) : cap;
}

/**
 * Every Nth of `ticks` from the first (rule 40), N = interval + 1: the explicit tick list of a chart
 * whose axis is numeric (the hero's days), thinned evenly instead of by Recharts' collision pass.
 */
export function everyNth(ticks, interval) {
  const n = Math.max(1, Number(interval) + 1 || 1);
  return ticks.filter((_, i) => i % n === 0);
}
