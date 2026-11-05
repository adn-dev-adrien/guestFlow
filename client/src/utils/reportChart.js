// Pure helpers of the report charts (specs/report-grammar.md): layout and export only. They never
// compute a figure — every value, share and total arrives from the server.

/** Index of the last non-null value of a series, -1 when it has none. */
export function lastValueIndex(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] != null) return i;
  return -1;
}

/**
 * The name written at the end of each line (rule 8): sorted top to bottom, each label pushed down
 * until it clears the one above by `minGap` pixels.
 * @param {Array<{ key: string, y: number }>} ends  pixel y of each series' last point
 * @returns {Array<{ key: string, y: number, labelY: number }>}
 */
export function layoutEndLabels(ends, minGap = 14, offset = 4) {
  let last = -Infinity;
  return [...ends].sort((a, b) => a.y - b.y).map((e) => {
    const labelY = Math.max(e.y + offset, last + minGap);
    last = labelY;
    return { ...e, labelY };
  });
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
