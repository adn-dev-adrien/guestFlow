/**
 * MonthlyRevenueChart — « Revenu par mois » of the Suivi financier (specs/finance-dashboard-redesign.md
 * rule 22): each month of the exercise, this year's column stacked « encaissé ou passé » (sapin) /
 * « à venir » (miel), last year's column beside it (sand) on comparable months; the window's months
 * highlighted when the window is not the whole exercise. Feature-local: it renders
 * `dashboard.revenueMonths` as is.
 *
 * Tooltip: one line per year — « Juillet 2026 : 11 938 € », then « Juillet 2025 : 12 257 € ».
 *
 * Props:
 *   months:          dashboard.revenueMonths
 *   highlightWindow: boolean
 *   previousYear:    string   legend of last year's column (e.g. « 2025 »)
 *   formatAmount:    (n) => string
 */
import React from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, ReferenceArea, CartesianGrid } from 'recharts';

const SAND = '#D9CFBA';
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function MonthTooltip({ active, payload, formatAmount }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <Box sx={{ bgcolor: '#27251F', color: '#fff', px: 1.25, py: 0.75, borderRadius: 1, fontSize: 12, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
      <Box><b>{capitalise(m.label)} : {formatAmount(m.revenue)}</b>{m.upcoming > 0 ? ` (dont ${formatAmount(m.upcoming)} à venir)` : ''}</Box>
      {m.previous != null && <Box>{capitalise(m.previousLabel)} : {formatAmount(m.previous)}</Box>}
    </Box>
  );
}

function Legend({ items }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', my: 1 }}>
      {items.map(([color, label]) => (
        <Box key={label} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ width: 10, height: 10, borderRadius: 0.75, bgcolor: color }} />{label}
        </Box>
      ))}
    </Box>
  );
}

export default function MonthlyRevenueChart({ months, highlightWindow, previousYear, formatAmount }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const hasPrevious = months.some((m) => m.previous != null);
  // A refund attributed to an otherwise empty month would draw below the axis: the column stays at
  // 0 and the tooltip keeps the real amount.
  const data = months.map((m) => ({ ...m, pastBar: Math.max(0, m.past), upcomingBar: Math.max(0, m.upcoming), previousBar: m.previous == null ? null : Math.max(0, m.previous) }));
  const windowMonths = highlightWindow ? months.filter((m) => m.inWindow) : [];
  return (
    <Box>
      <Legend items={[
        [theme.palette.primary.main, 'Encaissé ou passé'],
        [theme.palette.secondary.main, 'À venir'],
        ...(hasPrevious ? [[SAND, previousYear]] : []),
      ]} />
      {!hasPrevious && <Box sx={{ fontSize: 12, color: 'text.secondary', mt: -0.5, mb: 1 }}>Pas encore d'an dernier à comparer.</Box>}
      <ResponsiveContainer width="100%" height={isXs ? 190 : 230}>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap={isXs ? '12%' : '20%'}>
          <CartesianGrid vertical={false} stroke="#EFEBE3" />
          {windowMonths.length > 0 && <ReferenceArea x1={windowMonths[0].month} x2={windowMonths[windowMonths.length - 1].month} fill="#F3EFE6" fillOpacity={1} ifOverflow="extendDomain" />}
          <XAxis dataKey="month" tickFormatter={(k) => (months.find((m) => m.month === k) || {}).initial || ''} interval={0} tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
          <Tooltip content={<MonthTooltip formatAmount={formatAmount} />} cursor={{ fill: 'rgba(60,54,36,0.05)' }} />
          {hasPrevious && <Bar dataKey="previousBar" stackId="previous" fill={SAND} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
          <Bar dataKey="pastBar" stackId="current" fill={theme.palette.primary.main} isAnimationActive={false} />
          <Bar dataKey="upcomingBar" stackId="current" fill={theme.palette.secondary.main} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
