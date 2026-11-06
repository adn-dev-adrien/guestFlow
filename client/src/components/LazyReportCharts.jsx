/**
 * LazyReportCharts — the report charts as the plugin SDK hands them out (specs/report-grammar.md
 * rule 20): Recharts (~110 kB gzip) loads with the first chart drawn, never with the app shell. The
 * SDK is part of the initial bundle, so a static re-export would make every first page pay for it.
 * While the chart's code arrives, a quiet box of the chart's height holds its place.
 *
 * Exports, with exactly the props of the component they stand for:
 *   LazyTrendChart                    → TrendChart
 *   LazyAlignedDailyCumulativeCharts  → AlignedDailyCumulativeCharts
 */
import React, { Suspense, lazy } from 'react';
import { Box } from '@mui/material';

const TrendChart = lazy(() => import('./TrendChart'));
const AlignedDailyCumulativeCharts = lazy(() => import('./AlignedDailyCumulativeCharts'));

function ChartPlaceholder({ height }) {
  return <Box data-testid="chart-placeholder" aria-hidden="true" sx={{ height, borderRadius: '10px', bgcolor: 'background.default' }} />;
}

export function LazyTrendChart(props) {
  return (
    <Suspense fallback={<ChartPlaceholder height={(props.height ?? 220) + 52} />}>
      <TrendChart {...props} />
    </Suspense>
  );
}

export function LazyAlignedDailyCumulativeCharts(props) {
  return (
    <Suspense fallback={<ChartPlaceholder height={360} />}>
      <AlignedDailyCumulativeCharts {...props} />
    </Suspense>
  );
}
