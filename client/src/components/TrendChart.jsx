/**
 * TrendChart — lines over a category axis, the report chart of specs/report-grammar.md rules 8–13:
 * a light area under the series flagged `area`, last year dashed, each line named at its end, a
 * legend whose items switch series on and off, a crosshair and tooltip under the pointer or finger,
 * and a « ⋯ » menu (view as a table, copy the data). One y axis, never two. Every value comes from the
 * server; the chart only draws it. A null value is a gap, never a 0.
 *
 * Props:
 *   categories:       Array<{ key: string, label: string }>   the x axis, in order
 *   series:           Array<{ key, name, values: Array<number|null>, color?, area?, dashed?, hidden? }>
 *                     values align with categories; color defaults to the palette's n-th category
 *                     (a dashed series to the last-year edge); hidden = switched off at first
 *   formatValue:      (v: number) => string   tooltip and table values
 *   formatAxis?:      (v: number) => string   y ticks (default formatValue)
 *   ariaLabel:        string                  what the chart shows (also the table's caption)
 *   categoryHeader?:  string                  first column of the table and CSV, default « Période »
 *   height?:          number                  default 220
 */
import React, { useMemo, useState } from 'react';
import { Box, ButtonBase, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartMenu from './ChartMenu';
import ChartDataTable from './ChartDataTable';
import ChartEndLabels from './ChartEndLabels';
import { chart, categoricalColor } from '../utils/chartColors';
import { rowsFromSeries, tickInterval, toCsv } from '../utils/reportChart';

export const ALL_HIDDEN = 'Toutes les séries sont masquées.';

/** The colour each series is drawn in (rule 13): its own, else the last-year edge when dashed, else the palette's. */
export function withColors(series) {
  let n = 0;
  return series.map((s) => {
    if (s.color) return s;
    if (s.dashed) return { ...s, color: chart.lastYearEdge };
    const color = categoricalColor(n);
    n += 1;
    return { ...s, color };
  });
}

export function TrendTooltip({ active, payload, label, series, formatValue }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const shown = series.filter((s) => row[s.key] != null);
  if (!shown.length) return null;
  return (
    <Box sx={{ bgcolor: chart.tooltip, color: '#fff', px: 1.25, py: 1, borderRadius: '9px', fontSize: 12, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums', boxShadow: '0 8px 20px -10px rgba(0,0,0,.5)' }}>
      <Box sx={{ fontWeight: 700, mb: 0.25 }}>{row.label ?? label}</Box>
      {shown.map((s) => (
        <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', ...(s.dashed ? { border: `1.5px dashed ${s.color}` } : { bgcolor: s.color }) }} />
          {s.name} : {formatValue(row[s.key])}
        </Box>
      ))}
    </Box>
  );
}

/** The legend: one toggle button per series, crossed out when the series is hidden (rule 9). */
export function SeriesLegend({ series, hidden, onToggle }) {
  return (
    <Box role="group" aria-label="Séries affichées" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
      {series.map((s) => {
        const on = !hidden.has(s.key);
        return (
          <ButtonBase
            key={s.key}
            aria-pressed={on}
            onClick={() => onToggle(s.key)}
            sx={{
              fontSize: '0.8rem', px: 1, minHeight: 44, borderRadius: '8px', gap: 0.75,
              color: on ? 'text.primary' : '#A39C8C', textDecoration: on ? 'none' : 'line-through',
              '&:hover': { bgcolor: chart.band }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
            }}
          >
            <Box
              component="span"
              aria-hidden="true"
              sx={{ display: 'inline-block', width: 14, opacity: on ? 1 : 0.35, ...(s.dashed ? { borderTop: `2px dashed ${s.color}` } : { height: 3, borderRadius: '2px', bgcolor: s.color }) }}
            />
            {s.name}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export default function TrendChart({ categories, series, formatValue, formatAxis, ariaLabel, categoryHeader = 'Période', height = 220 }) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const colored = useMemo(() => withColors(series), [series]);
  const [hidden, setHidden] = useState(() => new Set(series.filter((s) => s.hidden).map((s) => s.key)));
  const [view, setView] = useState('chart');
  const rows = useMemo(() => rowsFromSeries(categories, colored), [categories, colored]);
  const visible = colored.filter((s) => !hidden.has(s.key));
  const toggle = (key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const getCsv = () => toCsv([categoryHeader, ...colored.map((s) => s.name)], rows.map((r) => [r.label, ...colored.map((s) => r[s.key])]));

  let body;
  if (view === 'table') {
    body = <ChartDataTable caption={ariaLabel} categoryHeader={categoryHeader} columns={colored.map((s) => ({ key: s.key, label: s.name }))} rows={rows} formatValue={formatValue} />;
  } else if (!visible.length) {
    body = <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary', fontSize: '0.9rem' }}>{ALL_HIDDEN}</Box>;
  } else {
    body = (
      <Box role="img" aria-label={ariaLabel} sx={{ '& .recharts-wrapper:focus, & .recharts-surface:focus': { outline: 'none' } }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ top: 12, right: narrow ? 70 : 92, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="key" tickFormatter={(k) => labelOf.get(k) ?? k} interval={tickInterval(rows.length, narrow)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: chart.tick }} />
            <YAxis width={60} tickFormatter={formatAxis || formatValue} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: chart.tick }} />
            <Tooltip content={<TrendTooltip series={visible} formatValue={formatValue} />} cursor={{ stroke: chart.lastYear, strokeWidth: 1 }} />
            {visible.filter((s) => s.area).map((s) => (
              <Area key={`${s.key}-area`} dataKey={s.key} stroke="none" fill={s.color} fillOpacity={0.1} connectNulls={false} isAnimationActive={false} activeDot={false} tooltipType="none" />
            ))}
            {visible.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={s.dashed ? 1.8 : 2.2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2, fill: s.color }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            <ChartEndLabels items={visible} categories={categories} />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    );
  }
  return (
    <Box sx={{ position: 'relative', minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.25, mb: 0.75 }}>
        <SeriesLegend series={colored} hidden={hidden} onToggle={toggle} />
        <ChartMenu view={view} onViewChange={setView} getCsv={getCsv} />
      </Box>
      {body}
    </Box>
  );
}
