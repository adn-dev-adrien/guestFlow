// The chart palette (specs/finance-dashboard-redesign.md rule 45), read from the theme's single token
// source (`palette.chart` in theme.js). Imported directly so a chart paints the same with or without
// a ThemeProvider above it (tooltips are rendered on their own in tests).
import appTheme from '../theme';

export const chart = appTheme.palette.chart;

// The colour of a logement on every chart: the server gives each logement a stable slot
// (`colorIndex`, id order), the palette paints it.
export function seriesColor(index) {
  return chart.series[(Number(index) || 0) % chart.series.length];
}
