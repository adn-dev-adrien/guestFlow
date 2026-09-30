/**
 * PickupCurveChart — « Montée en charge » of one stay month (specs/booking-pace.md rule 13): the
 * cumulative value on the books by days before the first of the month, this year solid up to today,
 * last year dashed, and a marker on today. Feature-local: it renders `/finance/pace/:month` as is.
 *
 * Props:
 *   curve:       { points: [{ daysBefore, current, lastYear }], todayDaysBefore, label, lastYearLabel }
 *   formatValue: (v) => string
 *   formatShort: (v) => string
 */
import React from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { GHOST_STROKE } from './PaceMonthChart';

const dayLabel = (d) => (d === 0 ? 'J' : `J-${d}`);
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function CurvePointTooltip({ active, payload, curve, formatValue }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Box sx={{ bgcolor: '#27251F', color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700 }}>{dayLabel(p.daysBefore)}</Box>
      {p.current != null && <Box>{capitalise(curve.label)} : {formatValue(p.current)}</Box>}
      {p.lastYear != null && <Box>{capitalise(curve.lastYearLabel)} : {formatValue(p.lastYear)}</Box>}
    </Box>
  );
}

export default function PickupCurveChart({ curve, formatValue, formatShort }) {
  const theme = useTheme();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={curve.points} margin={{ top: 14, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#EFEBE3" />
        <XAxis dataKey="daysBefore" type="number" reversed domain={[0, 365]} ticks={[365, 300, 240, 180, 120, 90, 60, 30, 0]} tickFormatter={dayLabel} tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
        <YAxis width={38} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={formatShort} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
        <Tooltip content={<CurvePointTooltip curve={curve} formatValue={formatValue} />} />
        <ReferenceLine x={curve.todayDaysBefore} stroke={theme.palette.secondary.main} strokeWidth={2} label={{ value: "aujourd'hui", position: 'insideTopLeft', fontSize: 11, fill: theme.palette.warning.main }} />
        <Line dataKey="lastYear" stroke={GHOST_STROKE} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
        <Line dataKey="current" stroke={theme.palette.primary.main} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
