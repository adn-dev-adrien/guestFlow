/**
 * FinanceExerciseOverview — the « vue de l'exercice » block of the Suivi financier
 * (specs/finance-exercise-overview-charts.md). Feature-local: it renders the server's
 * `summary.exerciseOverview` as is — three KPI tiles, « Revenu par mois » (stacked past / à venir),
 * « Par logement » and « Par canal ». Every figure, ratio and percentage comes from the server.
 *
 * Props:
 *   overview:        summary.exerciseOverview | undefined
 *   fiscalYearLabel: string            the exercise the block describes (« 2026 », « 2025-2026 »)
 *   onOpenBreakdown: () => void        opens the « Revenu total sur l'exercice » breakdown
 */
import React from 'react';
import { Box, Card, CardContent, Grid, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart, Bar, XAxis, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import EmptyState from './EmptyState';
import RankedBarList from './RankedBarList';
import { formatCurrencyRounded } from '../utils/formatters';
import { getPlatformColor, DEFAULT_PLATFORM_COLOR } from '../constants/platforms';

const TABULAR = { fontVariantNumeric: 'tabular-nums' };
const EMPTY_MESSAGE = 'Aucun revenu sur cet exercice.';
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function Tile({ label, value, caption, onClick }) {
  const clickable = Boolean(onClick);
  return (
    <Card
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Voir le détail : ${label}` : undefined}
      sx={{
        height: '100%', borderLeft: '3px solid', borderColor: 'primary.main',
        ...(clickable && { cursor: 'pointer', transition: 'transform .1s, box-shadow .1s', '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 } }),
      }}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>{label}</Typography>
        <Typography variant="kpiValue" component="p" sx={{ my: 0.5 }}>{value}</Typography>
        {caption && <Typography variant="caption" color="text.secondary" sx={TABULAR}>{caption}</Typography>}
      </CardContent>
    </Card>
  );
}

function MonthTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, boxShadow: 2, ...TABULAR }}>
      <Typography variant="body2" sx={{ fontWeight: 700, textTransform: 'capitalize' }}>{m.label}</Typography>
      <Typography variant="body2">{formatCurrencyRounded(m.revenue)} · {formatCurrencyRounded(m.revenueHt)} HT</Typography>
      <Typography variant="body2" color="text.secondary">{plural(m.nights, 'nuit')}</Typography>
      {m.upcoming > 0 && (
        <Typography variant="body2" color="text.secondary">dont {formatCurrencyRounded(m.upcoming)} à venir</Typography>
      )}
    </Box>
  );
}

function ChannelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, boxShadow: 2, ...TABULAR }}>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.label}</Typography>
      <Typography variant="body2">{formatCurrencyRounded(c.revenue)}</Typography>
      <Typography variant="body2" color="text.secondary">{plural(c.reservations, 'réservation')}</Typography>
    </Box>
  );
}

function LegendDot({ color, children }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box component="span" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }} />
      {children}
    </Box>
  );
}

export default function FinanceExerciseOverview({ overview, fiscalYearLabel, onOpenBreakdown }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  if (!overview) return null;

  const pastColor = theme.palette.primary.main;
  const upcomingColor = theme.palette.secondary.main;
  // Rule 15 — Direct echoes the « Part en direct » tile; each platform keeps its usual colour.
  const channelColor = (c) => {
    if (c.key === 'direct') return pastColor;
    if (c.key === 'others') return DEFAULT_PLATFORM_COLOR;
    return getPlatformColor(c.platform);
  };
  // A refund attributed to an otherwise empty month would draw below the axis: the column stays at 0
  // and the tooltip keeps the real amount (spec edge case).
  const monthData = overview.months.map((m) => ({ ...m, pastBar: Math.max(0, m.past), upcomingBar: Math.max(0, m.upcoming) }));
  const hasRevenue = overview.revenue > 0;

  return (
    <Box sx={{ mb: 2 }}>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Tile
            label="Revenu de l'exercice"
            value={formatCurrencyRounded(overview.revenue)}
            caption={`${formatCurrencyRounded(overview.revenueHt)} HT`}
            onClick={onOpenBreakdown}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Tile
            label="Nuits vendues"
            value={overview.nights.toLocaleString('fr-FR')}
            caption={plural(overview.properties.length, 'logement')}
            onClick={onOpenBreakdown}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Tile
            label="Part en direct"
            value={overview.direct.percent == null ? '—' : `${overview.direct.percent} %`}
            caption={`${formatCurrencyRounded(overview.direct.revenue)} sur ${formatCurrencyRounded(overview.revenue)}`}
          />
        </Grid>
      </Grid>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="sectionHeader">Revenu par mois</Typography>
            <Typography variant="caption" color="text.secondary">TTC · exercice {fiscalYearLabel}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, my: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary"><LegendDot color={pastColor}>Encaissé ou passé</LegendDot></Typography>
            <Typography variant="caption" color="text.secondary"><LegendDot color={upcomingColor}>À venir</LegendDot></Typography>
          </Box>
          <ResponsiveContainer width="100%" height={isMobile ? 180 : 220}>
            <BarChart data={monthData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={isMobile ? '12%' : '18%'}>
              <XAxis dataKey="initial" tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} interval={0} />
              <RechartsTooltip content={<MonthTooltip />} cursor={{ fill: theme.palette.action.hover }} />
              <Bar dataKey="pastBar" stackId="month" fill={pastColor} name="Encaissé ou passé">
                {/* Only the top segment of a column gets the rounded corners. */}
                {monthData.map((m) => <Cell key={m.month} radius={m.upcomingBar > 0 ? 0 : [4, 4, 0, 0]} />)}
              </Bar>
              <Bar dataKey="upcomingBar" stackId="month" fill={upcomingColor} name="À venir" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="sectionHeader" component="h3" sx={{ mb: 1.5 }}>Par logement</Typography>
              <RankedBarList
                items={overview.properties.map((p) => ({ key: p.propertyId, label: p.propertyName, value: p.revenue, ratio: p.ratio }))}
                formatValue={formatCurrencyRounded}
                emptyMessage={EMPTY_MESSAGE}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="sectionHeader" component="h3" sx={{ mb: 1.5 }}>Par canal</Typography>
              {!hasRevenue ? <EmptyState message={EMPTY_MESSAGE} py={3} /> : (
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
                  <Box sx={{ width: 150, height: 150, flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={overview.channels} dataKey="revenue" nameKey="label" innerRadius="58%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                          {overview.channels.map((c) => <Cell key={c.key} fill={channelColor(c)} />)}
                        </Pie>
                        <RechartsTooltip content={<ChannelTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {overview.channels.map((c) => (
                      <Typography component="li" variant="body2" key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.5 }}>
                        <Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: channelColor(c), flexShrink: 0 }} />
                        {c.label} · {c.percent} %
                      </Typography>
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
