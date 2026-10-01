/**
 * PaceMonthChart — « Réservations à venir, à date » (specs/booking-pace.md rules 5-7): per stay month,
 * this year on the books today (sapin), last year on the same date (sand), and last year's final as a
 * dashed ghost bar behind both. The écart sits under each month. Feature-local: it renders
 * `pace.months` as is.
 *
 * Props:
 *   months:        pace.months
 *   selected:      string | null   month whose pickup curve is open
 *   onSelectMonth: (month) => void
 *   formatValue:   (v) => string   value with its unit (« 3 nuits », « 1 250 € »)
 *   formatShort:   (v) => string   compact value for the axis and the écart (« 1,3 k »)
 */
import React from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea } from 'recharts';

export const SAND = '#D9CFBA';
export const GHOST_STROKE = '#9B8C68';
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function PaceTooltip({ active, payload, formatValue }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <Box sx={{ bgcolor: '#27251F', color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700 }}>{capitalise(m.label)}</Box>
      <Box>À date : {formatValue(m.current)}</Box>
      <Box>{capitalise(m.lastYearLabel)} à la même date : {m.sameTimeLastYear == null ? 'inconnu' : formatValue(m.sameTimeLastYear)}</Box>
      {m.lastYearFinal != null && <Box>{capitalise(m.lastYearLabel)} au final : {formatValue(m.lastYearFinal)}</Box>}
      {m.reachedPct != null && (
        <Box>Déjà {Math.round(m.reachedPct * 100)} % du final de l'an dernier{m.remaining > 0 ? ` · reste ${formatValue(m.remaining)}` : ''}</Box>
      )}
    </Box>
  );
}

// The écart as drawn under a month: « ▲ +4 », « ▼ −2 », « = 0 », or « — » when not comparable.
export function deltaText(m, formatShort) {
  if (m.delta == null) return '—';
  if (m.delta > 0) return `▲ +${formatShort(m.delta)}`;
  if (m.delta < 0) return `▼ −${formatShort(Math.abs(m.delta))}`;
  return '= 0';
}

function MonthTick({ x, y, payload, months, formatShort, theme }) {
  const m = months.find((mo) => mo.month === payload.value) || months[payload.index];
  if (!m) return null;
  const color = { success: theme.palette.success.main, error: theme.palette.error.main }[m.tone] || theme.palette.text.secondary;
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fontWeight={600} fill={theme.palette.text.primary}>{m.tick}</text>
      <text dy={28} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{deltaText(m, formatShort)}</text>
    </g>
  );
}

export default function PaceMonthChart({ months, selected, onSelectMonth, formatValue, formatShort }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const handleClick = (state) => {
    const m = state && state.activeTooltipIndex != null ? months[Number(state.activeTooltipIndex)] : null;
    if (m) onSelectMonth(m.month);
  };
  return (
    // On a phone the twelve months scroll inside the card, never the page.
    <Box sx={{ overflowX: { xs: 'auto', sm: 'visible' }, mx: { xs: -0.5, sm: 0 }, '& .recharts-wrapper:focus, & .recharts-surface:focus': { outline: 'none' } }}>
      <Box sx={{ minWidth: isXs ? 12 * 56 : 0, cursor: 'pointer' }}>
        <ResponsiveContainer width="100%" height={isXs ? 230 : 260}>
          <BarChart data={months} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap={isXs ? '14%' : '22%'} onClick={handleClick}>
            <CartesianGrid vertical={false} stroke="#EFEBE3" />
            {selected && <ReferenceArea x1={selected} x2={selected} xAxisId="main" fill="#F6EDD7" fillOpacity={1} ifOverflow="extendDomain" />}
            <XAxis xAxisId="ghost" dataKey="month" hide height={0} />
            <XAxis xAxisId="main" dataKey="month" interval={0} height={40} tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={<MonthTick months={months} formatShort={formatShort} theme={theme} />} />
            <YAxis width={38} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={formatShort} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
            <Tooltip content={<PaceTooltip formatValue={formatValue} />} cursor={{ fill: 'rgba(60,54,36,0.05)' }} />
            <Bar xAxisId="ghost" dataKey="lastYearFinal" fill="rgba(217,207,186,0.22)" stroke={GHOST_STROKE} strokeDasharray="4 3" strokeWidth={1.2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar xAxisId="main" dataKey="sameTimeLastYear" fill={SAND} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar xAxisId="main" dataKey="current" fill={theme.palette.primary.main} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
