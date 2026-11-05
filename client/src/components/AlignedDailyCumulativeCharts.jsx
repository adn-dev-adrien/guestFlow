/**
 * AlignedDailyCumulativeCharts — an amount per period and its running total, as two charts stacked on
 * the same time axis with one shared cursor (specs/report-grammar.md rule 14): bars on top, the
 * cumulative line (light area, optional dashed last year, names at the line ends) below. Never one
 * chart with two y axes. The running totals come from the server, like the amounts.
 *
 * Props:
 *   categories:          Array<{ key: string, label: string }>   the periods (days, weeks), in order
 *   daily:               Array<number|null>     amount of each period
 *   cumulative:          Array<number|null>     running total at each period
 *   previousCumulative?: Array<number|null>     last year's running total, same periods (dashed)
 *   labels?:             { daily, cumulative, previous }   default « Encaissé du jour », « Cumul », « Cumul l'an dernier »
 *   formatValue:         (v: number) => string
 *   formatAxis?:         (v: number) => string
 *   ariaLabel:           string
 *   categoryHeader?:     string                 default « Jour »
 */
import React, { useId, useMemo, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartMenu from './ChartMenu';
import ChartDataTable from './ChartDataTable';
import ChartEndLabels from './ChartEndLabels';
import { chart } from '../utils/chartColors';
import { tickInterval, toCsv } from '../utils/reportChart';

const DEFAULT_LABELS = { daily: 'Encaissé du jour', cumulative: 'Cumul', previous: "Cumul l'an dernier" };
const Y_WIDTH = 64;

export function DailyTooltip({ active, payload, labels, formatValue, hasPrevious }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const line = (text, value, swatch) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', ...swatch }} />
      {text} : {value == null ? '—' : formatValue(value)}
    </Box>
  );
  return (
    <Box sx={{ bgcolor: chart.tooltip, color: '#fff', px: 1.25, py: 1, borderRadius: '9px', fontSize: 12, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700, mb: 0.25 }}>{r.label}</Box>
      {line(labels.daily, r.daily, { bgcolor: chart.current })}
      {line(labels.cumulative, r.cumulative, { bgcolor: chart.current })}
      {hasPrevious && line(labels.previous, r.previous, { border: `1.5px dashed ${chart.lastYearEdge}` })}
    </Box>
  );
}

function Key({ swatch, text }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.8rem' }}>
      <Box component="span" aria-hidden="true" sx={{ display: 'inline-block', ...swatch }} />{text}
    </Box>
  );
}

export default function AlignedDailyCumulativeCharts({ categories, daily, cumulative, previousCumulative, labels: labelsIn, formatValue, formatAxis, ariaLabel, categoryHeader = 'Jour' }) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const syncId = useId();
  const [view, setView] = useState('chart');
  const labels = { ...DEFAULT_LABELS, ...labelsIn };
  const hasPrevious = Array.isArray(previousCumulative) && previousCumulative.some((v) => v != null);
  const rows = useMemo(() => categories.map((c, i) => ({
    key: c.key, label: c.label, daily: daily[i] ?? null, cumulative: cumulative[i] ?? null, previous: hasPrevious ? (previousCumulative[i] ?? null) : null,
  })), [categories, daily, cumulative, previousCumulative, hasPrevious]);
  const columns = [{ key: 'daily', label: labels.daily }, { key: 'cumulative', label: labels.cumulative }, ...(hasPrevious ? [{ key: 'previous', label: labels.previous }] : [])];
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const getCsv = () => toCsv([categoryHeader, ...columns.map((c) => c.label)], rows.map((r) => [r.label, ...columns.map((c) => r[c.key])]));
  const margin = { top: 8, right: narrow ? 52 : 84, bottom: 0, left: 0 };
  const yAxis = <YAxis width={Y_WIDTH} tickFormatter={formatAxis || formatValue} tickCount={3} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: chart.tick }} />;
  const ends = [
    { key: 'cumulative', name: labels.cumulative, color: chart.current, values: rows.map((r) => r.cumulative) },
    ...(hasPrevious ? [{ key: 'previous', name: 'N-1', color: chart.lastYearEdge, values: rows.map((r) => r.previous) }] : []),
  ];

  return (
    <Box sx={{ position: 'relative', minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.25, mb: 0.75 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, color: 'text.secondary' }}>
          <Key swatch={{ width: 10, height: 10, borderRadius: '2px', bgcolor: chart.current }} text={labels.daily} />
          <Key swatch={{ width: 14, height: 3, borderRadius: '2px', bgcolor: chart.current }} text={labels.cumulative} />
          {hasPrevious && <Key swatch={{ width: 14, borderTop: `2px dashed ${chart.lastYearEdge}` }} text={labels.previous} />}
        </Box>
        <ChartMenu view={view} onViewChange={setView} getCsv={getCsv} />
      </Box>
      {view === 'table' ? (
        <ChartDataTable caption={ariaLabel} categoryHeader={categoryHeader} columns={columns} rows={rows} formatValue={formatValue} />
      ) : (
        <Box role="img" aria-label={ariaLabel} sx={{ '& .recharts-wrapper:focus, & .recharts-surface:focus': { outline: 'none' } }}>
          <ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={rows} syncId={syncId} margin={margin}>
              <CartesianGrid vertical={false} stroke={chart.grid} />
              {/* recharts3 — a hidden axis still reserves its height unless told 0. */}
              <XAxis dataKey="key" scale="band" hide height={0} />
              {yAxis}
              <Tooltip content={() => null} cursor={{ fill: chart.cursor }} />
              <Bar dataKey="daily" fill={chart.current} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <Box sx={{ fontSize: '0.66rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary', pl: `${Y_WIDTH}px`, mt: 1.5, mb: 0.25 }}>{labels.cumulative}</Box>
          <ResponsiveContainer width="100%" height={176}>
            <ComposedChart data={rows} syncId={syncId} margin={margin}>
              <CartesianGrid vertical={false} stroke={chart.grid} />
              <XAxis dataKey="key" scale="band" tickFormatter={(k) => labelOf.get(k) ?? k} interval={tickInterval(rows.length, narrow)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: chart.tick }} />
              {yAxis}
              <Tooltip content={<DailyTooltip labels={labels} formatValue={formatValue} hasPrevious={hasPrevious} />} cursor={{ stroke: chart.lastYear, strokeWidth: 1 }} />
              {hasPrevious && <Line dataKey="previous" stroke={chart.lastYearEdge} strokeWidth={1.8} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />}
              <Area dataKey="cumulative" stroke={chart.current} strokeWidth={2.2} fill={chart.current} fillOpacity={0.1} dot={false} connectNulls={false} isAnimationActive={false} />
              <ChartEndLabels items={ends} categories={categories} band />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}
