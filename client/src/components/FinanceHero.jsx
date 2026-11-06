/**
 * FinanceHero — the light card at the top of the Suivi financier (specs/finance-dashboard-redesign.md
 * §3.2): the window's revenue, its comparison with last year, the goal bar, six figures no tile
 * repeats and the cumulative curve, graduated on the calendar by `hero.axis`. Until the first month of
 * the exercise is over (`hero.curveCompact`, rule 46) the curve stays, 56 px high instead of 120: no
 * summary line replaces it. Feature-local: it renders `dashboard.hero` as is.
 *
 * Props:
 *   hero:          dashboard.hero
 *   showHt:        dashboard.showHt — false when no stay of the view is under VAT (the HT figure is dropped)
 *   windowLabel:   string   « Exercice 2026 », « septembre 2026 »…
 *   asOf:          'YYYY-MM-DD' | null   « au <date> » while the window is running
 *   propertyName?: string
 *   fiscalYearLabel: string
 *   format:        { amount, perNight?, percent, date } presentational formatters (`perNight`: the per-night
 *                  amounts, to the cent under 100 €, specs/finance-revpar-year-over-year.md rule 24)
 *   comparisons?:  { nights, occupancy, revenuePerNight, revPar } — each the year-over-year pill props
 *                  (`utils/comparisonPill`), drawn under its figure (specs/finance-revpar-year-over-year.md rule 16)
 *   definitions?:  { nights, occupancy, revenuePerNight, revPar, openNights } — the « i » of each figure
 */
import React from 'react';
import { Box, LinearProgress, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AreaChart, Area, CartesianGrid, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import YearOverYearBadge from './YearOverYearBadge';
import DefinitionButton from './DefinitionButton';
import { chart } from '../utils/chartColors';
import useElementWidth from '../hooks/useElementWidth';
import { everyNth, xInterval } from '../utils/reportChart';

export function CurveTooltip({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Box sx={{ bgcolor: chart.tooltip, color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700 }}>au {format.date(p.day)}</Box>
      <Box>{p.current == null ? '—' : format.amount(p.current)} cette année</Box>
      {p.previous != null && <Box>{format.amount(p.previous)} l'an dernier</Box>}
    </Box>
  );
}

// The light card (specs/finance-dashboard-redesign.md rule 52, Adrien 2026-11-05, supersedes the ink
// banner of rule 31): white, a fir rule on top, the page's own text colours and chart tokens.
const CURVE_HEIGHT = 120;
const CURVE_HEIGHT_COMPACT = 56;

// `note` (specs/finance-revpar-year-over-year.md rule 20) — a word after the label: the open nights name
// the occupied ones, so that the rate reads as their ratio.
function Figure({ value, label, note, info, pill }) {
  return (
    <Box sx={{ position: 'relative', bgcolor: 'background.paper', px: { xs: 1.5, sm: 2 }, py: 1.5, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 72, minWidth: 0 }}>
      {info && <Box sx={{ position: 'absolute', top: 8, right: 8 }}><DefinitionButton label={label} definition={info} /></Box>}
      <Typography sx={{ fontWeight: 700, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, pr: info ? 3 : 0 }}>{value}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.25 }}>{label}{note ? ` · ${note}` : ''}</Typography>
      {pill && (
        // Rule 52 — one line from sm up: the pill never splits its « (N-1 : …) » there; on a phone it may wrap.
        <Box sx={{ mt: 0.5, '& > span': { flexWrap: { xs: 'wrap', sm: 'nowrap' }, whiteSpace: { sm: 'nowrap' } } }}>
          <YearOverYearBadge change={pill.change} previous={pill.previous} unit={pill.unit} showEmpty />
        </Box>
      )}
    </Box>
  );
}

export default function FinanceHero({ hero, showHt = true, windowLabel, asOf, propertyName, fiscalYearLabel, format, comparisons = {}, definitions = {} }) {
  const hasPrevious = hero.cumulative.some((p) => p.previous != null);
  const dash = '—';
  const perNight = format.perNight || format.amount;
  const labels = new Map(hero.axis.map((t) => [t.x, t.label]));
  // specs/report-grammar.md rule 40 — the month ticks are evenly spaced at every width: every Nth from
  // the first, N from the curve's measured width (never Recharts' collision pass, which drops months
  // unevenly).
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const [curveRef, curveWidth] = useElementWidth();
  const axisInterval = xInterval(hero.axis.map((t) => ({ key: t.x, label: t.label })), narrow, curveWidth ? curveWidth - 8 : null, { thin: false });
  const axisTicks = typeof axisInterval === 'number' ? everyNth(hero.axis.map((t) => t.x), axisInterval) : hero.axis.map((t) => t.x);
  return (
    <Box
      component="section"
      aria-label="Chiffre d'affaires"
      sx={{
        borderRadius: 1, color: 'text.primary', bgcolor: 'background.paper', mb: 2,
        border: 1, borderColor: 'divider', boxShadow: (t) => `inset 0 3px 0 ${t.palette.primary.main}`,
        px: { xs: 2, sm: 3 }, pt: { xs: 2.25, sm: 2.75 }, pb: 1.5,
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1.2fr)' }, gap: 3, alignItems: 'center' }}>
        <Box>
          <Typography variant="sectionHeader" component="p" sx={{ color: 'primary.main' }}>
            Chiffre d'affaires · {windowLabel}{asOf ? ` · au ${format.date(asOf)}` : ''}{propertyName ? ` · ${propertyName}` : ''}
          </Typography>
          <Typography component="p" sx={{ fontWeight: 700, fontSize: { xs: '2.25rem', sm: '3rem' }, lineHeight: 1.05, letterSpacing: '-0.02em', my: 1, fontVariantNumeric: 'tabular-nums' }}>
            {format.amount(hero.revenue)}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            {hero.yoy && <YearOverYearBadge change={hero.yoy.change} months={hero.yoy.months} totalMonths={hero.yoy.totalMonths} />}
            <Box component="span" sx={{ color: 'text.secondary' }}>{showHt ? `${format.amount(hero.revenueHt)} HT · ` : ''}net de commissions · {hero.stays} séjour{hero.stays > 1 ? 's' : ''}</Box>
          </Box>
          {hero.goal && (
            <Box sx={{ mt: 1.75, maxWidth: 520 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, hero.goal.ratio * 100)}
                aria-label="Progression vers l'objectif"
                sx={{ height: 10, borderRadius: 99, bgcolor: 'neutral.soft', '& .MuiLinearProgress-bar': { borderRadius: 99, bgcolor: 'primary.main' } }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', fontSize: 12.5, color: 'text.secondary', mt: 0.75 }}>
                <span><b>{format.percent(hero.goal.ratio)}</b> de l'objectif · reste {format.amount(hero.goal.remaining)}</span>
                <span>objectif {fiscalYearLabel} : {format.amount(hero.goal.amount)}</span>
              </Box>
            </Box>
          )}
        </Box>
        <Box
          // Hairlines between the cells are the divider showing through a 1 px gap, so they never double up.
          sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1px', borderRadius: '12px', overflow: 'hidden',
            bgcolor: 'divider', border: 1, borderColor: 'divider',
          }}
        >
          <Figure value={hero.nights.toLocaleString('fr-FR')} label="nuits vendues" info={definitions.nights} pill={comparisons.nights} />
          <Figure value={hero.occupancy == null ? dash : format.percent(hero.occupancy)} label="taux d'occupation" info={definitions.occupancy} pill={comparisons.occupancy} />
          <Figure value={hero.revenuePerNight == null ? dash : perNight(hero.revenuePerNight)} label="revenu moyen / nuit" info={definitions.revenuePerNight} pill={comparisons.revenuePerNight} />
          {'revPar' in hero && <Figure value={hero.revPar == null ? dash : perNight(hero.revPar)} label="RevPAR · par nuit ouverte" info={definitions.revPar} pill={comparisons.revPar} />}
          <Figure value={hero.directShare == null ? dash : format.percent(hero.directShare)} label="en direct" />
          {'openNights' in hero && <Figure value={hero.openNights.toLocaleString('fr-FR')} label="nuits ouvertes" note={`dont ${hero.occupiedNights.toLocaleString('fr-FR')} occupées`} info={definitions.openNights} />}
        </Box>
      </Box>
      <Box ref={curveRef} sx={{ mt: 2, pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', my: 0.75 }}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: chart.current }} />Cumulé</Box>
          {hasPrevious
            ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 16, borderTop: `2.5px dashed ${chart.lastYearEdge}` }} />Même période, an dernier</Box>
            : hero.yoy && <span>Courbe de l'an dernier dès que toute la période aura un an d'historique ; en attendant, comparaison mois par mois plus bas.</span>}
        </Box>
        <ResponsiveContainer width="100%" height={hero.curveCompact ? CURVE_HEIGHT_COMPACT : CURVE_HEIGHT}>
          <AreaChart data={hero.cumulative} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="heroFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={chart.current} stopOpacity={0.18} />
                <stop offset="1" stopColor={chart.current} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid horizontal={false} stroke={chart.grid} />
            <XAxis
              type="number" dataKey="x" domain={['dataMin', 'dataMax']}
              ticks={axisTicks} tickFormatter={(x) => labels.get(x)} interval={typeof axisInterval === 'number' ? 0 : axisInterval}
              tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: chart.tick, textAnchor: 'start' }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip content={<CurveTooltip format={format} />} cursor={{ stroke: chart.lastYearEdge }} />
            {hasPrevious && <Line dataKey="previous" stroke={chart.lastYearEdge} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            <Area dataKey="current" stroke={chart.current} strokeWidth={2.6} fill="url(#heroFill)" connectNulls={false} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
