/**
 * FinanceHero — the green banner at the top of the Suivi financier (specs/finance-dashboard-redesign.md
 * §3.2): the window's revenue, its comparison with last year, the goal bar, four figures no tile
 * repeats and the cumulative curve. Feature-local: it renders `dashboard.hero` as is.
 *
 * Props:
 *   hero:          dashboard.hero
 *   windowLabel:   string   « Exercice 2026 », « septembre 2026 »…
 *   asOf:          'YYYY-MM-DD' | null   « au <date> » while the window is running
 *   propertyName?: string
 *   fiscalYearLabel: string
 *   format:        { amount, percent, date } presentational formatters
 */
import React from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import YearOverYearBadge from './YearOverYearBadge';

export function CurveTooltip({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Box sx={{ bgcolor: '#27251F', color: '#fff', px: 1.25, py: 0.75, borderRadius: 1, fontSize: 12, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ fontWeight: 700 }}>au {format.date(p.day)}</Box>
      <Box>{p.current == null ? '—' : format.amount(p.current)} cette année</Box>
      {p.previous != null && <Box>{format.amount(p.previous)} l'an dernier</Box>}
    </Box>
  );
}

function Mini({ value, label }) {
  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 3, px: 1.5, py: 1.25 }}>
      <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" sx={{ opacity: 0.85 }}>{label}</Typography>
    </Box>
  );
}

export default function FinanceHero({ hero, windowLabel, asOf, propertyName, fiscalYearLabel, format }) {
  const hasPrevious = hero.cumulative.some((p) => p.previous != null);
  const dash = '—';
  return (
    <Box
      component="section"
      aria-label="Chiffre d'affaires"
      sx={{
        position: 'relative', overflow: 'hidden', borderRadius: 4.5, color: '#fff', mb: 2,
        px: { xs: 2, sm: 3 }, pt: { xs: 2.25, sm: 2.75 }, pb: 1.5,
        background: 'linear-gradient(135deg, #2F5D46 0%, #244A38 55%, #1E3D2F 100%)',
        boxShadow: '0 8px 28px rgba(36,74,56,0.28)',
        '&::before': { content: '""', position: 'absolute', right: 0, top: 0, width: 320, height: 260, pointerEvents: 'none', background: 'radial-gradient(circle at 80% 10%, rgba(201,144,56,0.38), rgba(201,144,56,0) 65%)' },
      }}
    >
      <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' }, gap: 2.25, alignItems: 'end' }}>
        <Box>
          <Typography variant="sectionHeader" component="p" sx={{ opacity: 0.92 }}>
            Chiffre d'affaires · {windowLabel}{asOf ? ` · au ${format.date(asOf)}` : ''}{propertyName ? ` · ${propertyName}` : ''}
          </Typography>
          <Typography component="p" sx={{ fontWeight: 700, fontSize: { xs: '2.25rem', sm: '3rem' }, lineHeight: 1.05, my: 1, fontVariantNumeric: 'tabular-nums' }}>
            {format.amount(hero.revenue)}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            {hero.yoy && <YearOverYearBadge change={hero.yoy.change} months={hero.yoy.months} totalMonths={hero.yoy.totalMonths} onDark />}
            <Box component="span" sx={{ opacity: 0.85 }}>{format.amount(hero.revenueHt)} HT · net de commissions · {hero.stays} séjour{hero.stays > 1 ? 's' : ''}</Box>
          </Box>
          {hero.goal && (
            <Box sx={{ mt: 1.75, maxWidth: 520 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, hero.goal.ratio * 100)}
                aria-label="Progression vers l'objectif"
                sx={{ height: 10, borderRadius: 99, bgcolor: 'rgba(255,255,255,0.18)', '& .MuiLinearProgress-bar': { borderRadius: 99, background: 'linear-gradient(90deg, #E3B566, #C99038)' } }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', fontSize: 12.5, opacity: 0.92, mt: 0.75 }}>
                <span><b>{format.percent(hero.goal.ratio)}</b> de l'objectif · reste {format.amount(hero.goal.remaining)}</span>
                <span>objectif {fiscalYearLabel} : {format.amount(hero.goal.amount)}</span>
              </Box>
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
          <Mini value={hero.nights.toLocaleString('fr-FR')} label="nuits vendues" />
          <Mini value={hero.occupancy == null ? dash : format.percent(hero.occupancy)} label="taux d'occupation" />
          <Mini value={hero.revenuePerNight == null ? dash : format.amount(hero.revenuePerNight)} label="revenu moyen / nuit" />
          <Mini value={hero.directShare == null ? dash : format.percent(hero.directShare)} label="en direct" />
        </Box>
      </Box>
      <Box sx={{ position: 'relative', mt: 1.75, pt: 0.75, borderTop: '1px solid rgba(255,255,255,0.14)' }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'rgba(255,255,255,0.85)', my: 0.75 }}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 10, height: 10, borderRadius: 0.75, bgcolor: '#fff' }} />Cumulé</Box>
          {hasPrevious
            ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Box component="span" sx={{ width: 16, borderTop: '2.5px dashed rgba(255,255,255,0.75)' }} />Même période, an dernier</Box>
            : hero.yoy && <span>Courbe de l'an dernier dès que toute la période aura un an d'historique ; en attendant, comparaison mois par mois plus bas.</span>}
        </Box>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={hero.cumulative} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="heroFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.28} />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tickFormatter={format.date} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.72)' }} minTickGap={40} />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip content={<CurveTooltip format={format} />} cursor={{ stroke: 'rgba(255,255,255,0.4)' }} />
            {hasPrevious && <Line dataKey="previous" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            <Area dataKey="current" stroke="#fff" strokeWidth={2.6} fill="url(#heroFill)" connectNulls={false} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
