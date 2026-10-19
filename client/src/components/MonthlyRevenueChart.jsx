/**
 * MonthlyRevenueChart — « Revenu par mois » of the Suivi financier (specs/finance-dashboard-redesign.md
 * rules 22 and 44): each month of the exercise, this year's column stacked « encaissé ou passé »
 * (sapin) / « à venir » (miel profond), last year's column beside it (sable, outlined) on comparable
 * months; the window's months highlighted when the window is not the whole exercise. Readable without
 * hover: the month's total (`totalLabel`, chosen and written by the server) sits above its column,
 * the current month is marked (bold sapin, underlined), months are abbreviated from `sm` up
 * (« janv. ») and initials on a phone. Colours are the theme's chart tokens (rule 45). Feature-local: it renders `dashboard.revenueMonths` as is.
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
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, ReferenceArea, CartesianGrid, LabelList } from 'recharts';
import { chart as c } from '../utils/chartColors';

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function MonthTooltip({ active, payload, formatAmount }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <Box sx={{ bgcolor: c.tooltip, color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
      <Box><b>{capitalise(m.label)} : {formatAmount(m.revenue)}</b>{m.upcoming > 0 ? ` (dont ${formatAmount(m.upcoming)} à venir)` : ''}</Box>
      {m.previous != null && <Box>{capitalise(m.previousLabel)} : {formatAmount(m.previous)}</Box>}
    </Box>
  );
}

// The month under its column: abbreviation (or initial on a phone); the current month bold sapin,
// underlined, so the eye finds « now » without reading.
export function MonthTick({ x, y, payload, months, compact }) {
  const m = months.find((mo) => mo.month === payload.value) || months[payload.index];
  if (!m) return null;
  const text = compact ? m.initial : (m.short || m.initial);
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fontWeight={m.isCurrent ? 700 : 400} fill={m.isCurrent ? c.current : c.tick}>{text}</text>
      {m.isCurrent && <rect x={-9} y={17} width={18} height={2} rx={1} fill={c.current} data-testid="current-month-mark" />}
    </g>
  );
}

// The total written above the whole stack. The server says which months carry one and on which
// segment (`totalLabel`, `labelOn`: the top of the stack); this only draws it.
export function TotalLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={c.value} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </text>
  );
}

function Legend({ items }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', my: 1 }}>
      {items.map(([swatch, label]) => (
        <Box key={label} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', ...swatch }} />{label}
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
  const data = months.map((m) => ({
    ...m,
    pastBar: Math.max(0, m.past),
    upcomingBar: Math.max(0, m.upcoming),
    previousBar: m.previous == null ? null : Math.max(0, m.previous),
    totalOnPast: m.labelOn === 'past' ? m.totalLabel : '',
    totalOnUpcoming: m.labelOn === 'upcoming' ? m.totalLabel : '',
  }));
  const windowMonths = highlightWindow ? months.filter((m) => m.inWindow) : [];
  return (
    <Box>
      <Legend items={[
        [{ bgcolor: c.current }, 'Encaissé ou passé'],
        [{ bgcolor: c.upcoming }, 'À venir'],
        ...(hasPrevious ? [[{ bgcolor: c.lastYear, outline: `1px solid ${c.lastYearEdge}`, outlineOffset: '-1px' }, previousYear]] : []),
      ]} />
      <Box
        sx={{
          '& .recharts-wrapper:focus, & .recharts-surface:focus': { outline: 'none' },
          '& .recharts-wrapper:focus-visible, & .recharts-surface:focus-visible': { outline: `2px solid ${c.current}`, outlineOffset: 2, borderRadius: '4px' },
        }}
      >
        <ResponsiveContainer width="100%" height={isXs ? 200 : 240}>
          <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap={isXs ? '12%' : '20%'}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            {windowMonths.length > 0 && <ReferenceArea x1={windowMonths[0].month} x2={windowMonths[windowMonths.length - 1].month} fill={c.band} fillOpacity={1} ifOverflow="extendDomain" />}
            <XAxis dataKey="month" interval={0} height={26} tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={<MonthTick months={months} compact={isXs} />} />
            <Tooltip content={<MonthTooltip formatAmount={formatAmount} />} cursor={{ fill: c.cursor }} />
            {hasPrevious && <Bar dataKey="previousBar" stackId="previous" fill={c.lastYear} stroke={c.lastYearEdge} strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
            <Bar dataKey="pastBar" stackId="current" fill={c.current} isAnimationActive={false}>
              <LabelList dataKey="totalOnPast" content={<TotalLabel />} />
            </Bar>
            <Bar dataKey="upcomingBar" stackId="current" fill={c.upcoming} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="totalOnUpcoming" content={<TotalLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      {!hasPrevious && <Box sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>Pas encore d'an dernier à comparer.</Box>}
    </Box>
  );
}
