/**
 * SmallMultiplesLineChart — one small line chart per series, this period solid with points, the
 * previous one dashed, in the series' colour (specs/finance-dashboard-redesign.md rule 23). A null
 * value is a gap, never a 0. The tooltip of a chart speaks of its own series only. Generic: any
 * « one curve per item, this year vs last year » comparison.
 *
 * Props:
 *   series:        Array<{ key, title, color, caption?, points: Array<{ key, tick, label, current, previous }> }>
 *   currentLabel:  string     legend of the solid line (e.g. « 2026 »)
 *   previousLabel: string     legend of the dashed line (e.g. « 2025 »)
 *   formatValue:   (v) => string
 *   domain?:       [min, max] y axis (default [0, 1])
 *   height?:       number     height of each small chart (default 110)
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function SeriesTooltip({ active, payload, title, previousLabel, formatValue }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Box sx={{ bgcolor: '#27251F', color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700 }}>{title}</Box>
      <Box sx={{ textTransform: 'capitalize' }}>{p.label} : {p.current == null ? '—' : formatValue(p.current)}</Box>
      {p.previous != null && <Box>{previousLabel} : {formatValue(p.previous)}</Box>}
    </Box>
  );
}

export default function SmallMultiplesLineChart({ series, currentLabel, previousLabel, formatValue, domain = [0, 1], height = 110 }) {
  const hasPrevious = series.some((s) => s.points.some((p) => p.previous != null));
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', mb: 1 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 16, borderTop: '3px solid', borderColor: 'text.primary' }} />{currentLabel} (trait plein)</Box>
        {hasPrevious && <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 16, borderTop: '2.5px dashed', borderColor: 'text.primary' }} />{previousLabel} (pointillé)</Box>}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        {series.map((s) => (
          <Box key={s.key} data-testid={`small-multiple-${s.key}`} sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', px: 1.25, pt: 1, pb: 0.5, minWidth: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>
              <Box component="span" sx={{ color: s.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>● {s.title}</Box>
              {s.caption && <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{s.caption}</Typography>}
            </Box>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart data={s.points} margin={{ top: 4, right: 6, bottom: 0, left: -28 }}>
                <CartesianGrid vertical={false} stroke="#EFEBE3" />
                <XAxis dataKey="key" tickFormatter={(k) => (s.points.find((p) => p.key === k) || {}).tick || ''} interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6E6A5E' }} />
                <YAxis domain={domain} ticks={[domain[0], (domain[0] + domain[1]) / 2, domain[1]]} tickFormatter={(v) => Math.round(v * 100)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#A39E92' }} />
                <Tooltip content={<SeriesTooltip title={s.title} previousLabel={previousLabel} formatValue={formatValue} />} cursor={{ stroke: '#D9D3C6' }} />
                <Line dataKey="previous" stroke={s.color} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.85} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="current" stroke={s.color} strokeWidth={2.4} dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
