/**
 * PaceMonthChart — « Réservations à venir, à date » (specs/booking-pace.md rules 5-7, 14-15): per stay
 * month, this year on the books today (sapin), last year on the same date (sable, outlined), and last
 * year's final as a dashed ghost bar behind both. The écart sits under each month once a month is
 * comparable (`hasComparison`). Feature-local: it renders `pace.months` as is.
 *
 * On a phone the chart stays a chart (UI/UX review 2026-10-18, decision 9): twelve columns of 56 px
 * scroll inside the card, the value axis stays fixed on the left, a faded edge says there is more,
 * and the scroll is set on the server's current month (`isCurrent`) on arrival and whenever the
 * payload changes. One tap — or one click — on a column opens its month (rule 15).
 *
 * Props:
 *   months:        pace.months
 *   hasComparison: boolean         pace.hasComparison — draws the écart row
 *   selected:      string | null   month whose pickup curve is open
 *   onSelectMonth: (month) => void
 *   formatValue:   (v) => string   value with its unit (« 3 nuits », « 1 250 € »)
 *   formatShort:   (v) => string   compact value for the axis and the écart (« 1,3 k »)
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea } from 'recharts';
import { chart as c } from '../utils/chartColors';

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const COLUMN_XS = 56;
const AXIS_WIDTH = 38;
const MARGIN = { top: 6, right: 4, bottom: 0, left: 0 };

export function PaceTooltip({ active, payload, formatValue }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <Box sx={{ bgcolor: c.tooltip, color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
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

// Month under its column (current month bold sapin, underlined), the écart below when a comparison
// exists. Focusable: Enter or Space opens the month, like a tap.
export function MonthTick({ x, y, payload, months, formatShort, hasComparison, onSelectMonth, theme }) {
  const m = months.find((mo) => mo.month === payload.value) || months[payload.index];
  if (!m) return null;
  const color = { success: theme.palette.success.main, error: theme.palette.error.main }[m.tone] || c.tick;
  const open = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelectMonth(m.month);
  };
  return (
    <g transform={`translate(${x},${y})`} tabIndex={0} role="button" aria-label={`${capitalise(m.label)} : ${m.current}`} onKeyDown={open} style={{ outline: 'none' }}>
      <text dy={12} textAnchor="middle" fontSize={11} fontWeight={m.isCurrent ? 700 : 600} fill={m.isCurrent ? c.current : c.value}>{m.tick}</text>
      {m.isCurrent && <rect x={-10} y={17} width={20} height={2} rx={1} fill={c.current} />}
      {hasComparison && <text dy={33} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{deltaText(m, formatShort)}</text>}
    </g>
  );
}

// The three bars, shared by the chart and by the fixed axis drawn beside it on a phone (same data,
// same bars → the same value scale).
function bars(visible) {
  const hidden = { fill: 'transparent', stroke: 'none' };
  return [
    <Bar key="ghost" xAxisId="ghost" dataKey="lastYearFinal" {...(visible ? { fill: c.ghostFill, stroke: c.lastYearEdge, strokeDasharray: '4 3', strokeWidth: 1.2 } : hidden)} radius={[4, 4, 0, 0]} isAnimationActive={false} />,
    <Bar key="same" xAxisId="main" dataKey="sameTimeLastYear" {...(visible ? { fill: c.lastYear, stroke: c.lastYearEdge, strokeWidth: 1 } : hidden)} radius={[3, 3, 0, 0]} isAnimationActive={false} />,
    <Bar key="current" xAxisId="main" dataKey="current" {...(visible ? { fill: c.current } : hidden)} radius={[3, 3, 0, 0]} isAnimationActive={false} />,
  ];
}

export default function PaceMonthChart({ months, hasComparison, selected, onSelectMonth, formatValue, formatShort }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const scroller = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const height = isXs ? 230 : 260;
  const axisHeight = hasComparison ? 40 : 24;
  const axisInside = isXs ? 0 : AXIS_WIDTH;

  const readEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  // Rule 14 — set on the current month whenever a payload arrives (first load, metric, logement).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const index = Math.max(0, months.findIndex((m) => m.isCurrent));
    el.scrollLeft = isXs ? index * COLUMN_XS : 0;
    readEdges();
  }, [months, isXs, readEdges]);

  // Rule 15 — the column under the pointer, from the geometry of the plot: one tap is enough, the
  // tooltip's active index (set by a hover) is not needed.
  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = MARGIN.left + axisInside;
    const width = rect.width - left - MARGIN.right;
    const index = Math.floor(((e.clientX - rect.left - left) / width) * months.length);
    if (index >= 0 && index < months.length) onSelectMonth(months[index].month);
  };

  const fade = (side) => ({
    position: 'absolute', top: 0, bottom: axisHeight, width: 28, pointerEvents: 'none', zIndex: 1,
    [side]: side === 'left' ? AXIS_WIDTH : 0,
    background: `linear-gradient(${side === 'left' ? 90 : 270}deg, #fff, rgba(255,255,255,0))`,
    opacity: edges[side] ? 1 : 0, transition: 'opacity .2s',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  });

  const axis = <YAxis width={AXIS_WIDTH} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={formatShort} tick={{ fontSize: 11, fill: c.tick }} />;

  return (
    <Box sx={{ display: 'flex', position: 'relative', '& .recharts-wrapper:focus, & .recharts-surface:focus': { outline: 'none' } }}>
      {isXs && (
        <Box sx={{ flex: `0 0 ${AXIS_WIDTH}px` }} aria-hidden="true" data-testid="pace-fixed-axis">
          <ResponsiveContainer width={AXIS_WIDTH} height={height}>
            <BarChart data={months} margin={{ ...MARGIN, right: 0 }}>
              <XAxis xAxisId="ghost" dataKey="month" hide height={0} />
              <XAxis xAxisId="main" dataKey="month" hide height={axisHeight} />
              {axis}
              {bars(false)}
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}
      {isXs && <Box sx={fade('left')} />}
      <Box
        ref={scroller}
        onScroll={readEdges}
        data-testid="pace-scroller"
        sx={{ flex: '1 1 auto', minWidth: 0, overflowX: { xs: 'auto', sm: 'visible' }, overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        <Box sx={{ minWidth: isXs ? months.length * COLUMN_XS : 0, cursor: 'pointer', '& g[role=button]:focus-visible text:first-of-type': { textDecoration: 'underline' } }} onClick={handleClick}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={months} margin={MARGIN} barGap={3} barCategoryGap={isXs ? '14%' : '22%'}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              {selected && <ReferenceArea x1={selected} x2={selected} xAxisId="main" fill={c.selected} fillOpacity={0.6} ifOverflow="extendDomain" />}
              <XAxis xAxisId="ghost" dataKey="month" hide height={0} />
              <XAxis xAxisId="main" dataKey="month" interval={0} height={axisHeight} tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={<MonthTick months={months} formatShort={formatShort} hasComparison={hasComparison} onSelectMonth={onSelectMonth} theme={theme} />} />
              {isXs ? <YAxis hide width={0} /> : axis}
              <Tooltip content={<PaceTooltip formatValue={formatValue} />} cursor={{ fill: c.cursor }} />
              {bars(true)}
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>
      {isXs && <Box sx={fade('right')} />}
    </Box>
  );
}
