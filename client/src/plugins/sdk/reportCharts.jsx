/**
 * The report charts a plugin renders (specs/report-grammar.md rules 8–14), loaded on first use. `hostModules`
 * imports the whole SDK in the initial bundle, so exporting the charts directly pulled Recharts into every page's
 * first load (review R5-01, budget of scripts/check-bundle-budget.mjs): here they are fetched when a plugin page
 * first draws one, with the same props, behind a box of the chart's height.
 *
 * Props: those of `components/TrendChart` and `components/AlignedDailyCumulativeCharts`.
 */
import React, { Suspense, lazy } from 'react';
import { Box } from '@mui/material';

const LazyTrendChart = lazy(() => import('../../components/TrendChart'));
const LazyAligned = lazy(() => import('../../components/AlignedDailyCumulativeCharts'));

const Placeholder = ({ height }) => <Box aria-hidden="true" sx={{ height }} />;

export function TrendChart(props) {
  return (
    <Suspense fallback={<Placeholder height={(props.height || 220) + 40} />}>
      <LazyTrendChart {...props} />
    </Suspense>
  );
}

export function AlignedDailyCumulativeCharts(props) {
  return (
    <Suspense fallback={<Placeholder height={330} />}>
      <LazyAligned {...props} />
    </Suspense>
  );
}
