import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Box, Typography, Card, CardContent, Grid, TextField, MenuItem, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TableFooter, Chip, Divider, Tabs, Tab,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SyncIcon from '@mui/icons-material/Sync';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from 'recharts';
import PageActionBar from '../components/PageActionBar';
import OperationalPaymentsTable from '../components/OperationalPaymentsTable';
import FinanceBreakdownDialog from '../components/FinanceBreakdownDialog';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import StatusBadge from '../components/StatusBadge';
import PlatformChip from '../components/PlatformChip';
import { displayDate, formatCurrency, formatCurrencyRounded } from '../utils/formatters';
import api from '../api';

const RADIAN = Math.PI / 180;
const TABULAR = { fontVariantNumeric: 'tabular-nums' };
// specs/finance-overview-rework.md §3.4 — the amounts sit INSIDE the camembert (white text at each slice
// centroid). White-on-fill is legible and matches `common.white`.
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
  if (!value) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {formatCurrencyRounded(value)}
    </text>
  );
};

// specs/fiscal-year-and-nights-sold.md §3.4 rule 20 + §6.2 — « Gîte 187 nuits · Lodge 142 nuits ».
// Logements with no night in the window drop out; nothing to show → no line at all.
const nightsLine = (byProperty) => (byProperty || [])
  .filter((p) => p.nights > 0)
  .map((p) => `${p.propertyName} ${p.nights} nuit${p.nights > 1 ? 's' : ''}`)
  .join(' · ');

export default function FinancePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
    return d.toISOString().split('T')[0];
  });
  // specs/finance-overview-rework.md §3.4 — the projection date defaults to today + 1 month.
  const [projectionDate, setProjectionDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  });
  // specs/fiscal-year-and-nights-sold.md §3.5 — the selected exercise lives in the URL (`?exercice=`)
  // so the back button restores it after opening a reservation, exactly like AccountingPage's
  // `?month=&year=`. Empty → the server answers on the current exercise.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFiscalYear = searchParams.get('exercice') || '';
  const setSelectedFiscalYear = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key) next.set('exercice', String(key)); else next.delete('exercice');
    setSearchParams(next, { replace: true });
  };
  const [summary, setSummary] = useState(null);
  const [projection, setProjection] = useState(null);
  const [operational, setOperational] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [financeViewTab, setFinanceViewTab] = useState('overdue');
  // specs/finance-per-property-revenue-chart.md — window of the « Revenu par logement » chart.
  const [chartTab, setChartTab] = useState('period');
  // specs/finance-card-breakdown.md — the card whose breakdown dialog is open (null = closed).
  const [breakdownMetric, setBreakdownMetric] = useState(null);

  // Loaders no longer swallow errors silently (specs/ds-sweep-finance.md §3.8): any failure raises a
  // retryable ErrorAlert instead of leaving the page blank.
  const loadSummary = useCallback(async () => {
    try { setSummary(await api.getFinanceSummary(from, to, selectedFiscalYear)); } catch { setLoadError(true); }
  }, [from, to, selectedFiscalYear]);
  const loadProjection = useCallback(async () => {
    try { setProjection(await api.getFinanceProjection(projectionDate)); } catch { setLoadError(true); }
  }, [projectionDate]);
  const loadOperational = useCallback(async () => {
    try { setOperational(await api.getFinanceOperational()); } catch { setLoadError(true); }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadProjection(); }, [loadProjection]);
  useEffect(() => { loadOperational(); }, [loadOperational]);

  const refreshAll = useCallback(async () => {
    setLoadError(false);
    await Promise.all([loadSummary(), loadProjection(), loadOperational()]);
  }, [loadSummary, loadProjection, loadOperational]);

  const handleTogglePayment = async (reservation, field) => {
    await api.markPayment(reservation.id, { [field]: !reservation[field] });
    await refreshAll();
  };

  // specs/finance-overview-rework.md §3.6 — « Tout solder » marks every still-open component paid.
  const handleSettleAll = async (r) => {
    const payload = {};
    if (!r.depositDisabled && Number(r.depositAmount || 0) > 0 && !r.depositPaid) payload.depositPaid = true;
    if (Number(r.balanceAmount || 0) > 0 && !r.balancePaid) payload.balancePaid = true;
    if (Number(r.complementAmount || 0) > 0 && !r.complementPaid) payload.complementPaid = true;
    if (Number(r.endOfStayComplementAmount || 0) > 0 && !r.endOfStayComplementPaid) payload.endOfStayComplementPaid = true;
    if (Object.keys(payload).length === 0) return;
    await api.markPayment(r.id, payload);
    await refreshAll();
  };

  // Pie « Encaissé » vs « En attente », colored from theme tokens (specs/ds-sweep-finance.md §3.3).
  const pieData = summary ? [
    { name: 'Encaissé', value: summary.totalCollected, fill: theme.palette.success.main },
    { name: 'En attente', value: summary.totalPending, fill: theme.palette.warning.main },
  ] : [];

  // specs/finance-per-property-revenue-chart.md — the chart windows: « Sur la période » (du/au) or
  // « Depuis le début de l'année » (Jan 1 → today). Both arrays are zero-seeded server-side, so keep
  // only logements with actual revenue for the bars (the « Aucun revenu… » empty state relies on it).
  const chartSource = chartTab === 'year' ? summary?.yearToDateByProperty : summary?.revenueByProperty;
  const barData = chartSource?.filter((p) => p.revenue > 0).map((p) => ({ name: p.propertyName, revenue: p.revenue, revenueHt: p.revenueHt, nights: p.nights })) || [];

  // In-bar label: TTC bold, its HT beneath (discreet, mirrors the KPI cards' HT sub-line), then the
  // nights sold over the same window (specs/fiscal-year-and-nights-sold.md §3.4 rule 21 — this is
  // where the period's nights are read).
  //
  // A bar too short to hold all three lines does NOT drop the nights: they move just above the bar,
  // in the chart's text color. A low-revenue logement is exactly where nights-vs-revenue is worth
  // reading, so that line must survive a short bar.
  const renderBarLabel = ({ x, y, width, height, index }) => {
    const d = barData[index];
    if (!d) return null;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const nightsLabel = `${d.nights} nuit${d.nights > 1 ? 's' : ''}`;
    const nightsAboveBar = (
      <text x={cx} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={theme.palette.text.secondary}>
        {nightsLabel}
      </text>
    );
    if (height < 40) {
      return (
        <g>
          {nightsAboveBar}
          <text x={cx} y={cy} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
            {formatCurrencyRounded(d.revenue)}
          </text>
        </g>
      );
    }
    if (height < 62) {
      return (
        <g>
          {nightsAboveBar}
          <text x={cx} y={cy - 8} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
            {formatCurrencyRounded(d.revenue)}
          </text>
          <text x={cx} y={cy + 10} fill="rgba(255,255,255,0.75)" textAnchor="middle" dominantBaseline="central" fontSize={10}>
            {formatCurrencyRounded(d.revenueHt)} HT
          </text>
        </g>
      );
    }
    return (
      <g>
        <text x={cx} y={cy - 18} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
          {formatCurrencyRounded(d.revenue)}
        </text>
        <text x={cx} y={cy} fill="rgba(255,255,255,0.75)" textAnchor="middle" dominantBaseline="central" fontSize={10}>
          {formatCurrencyRounded(d.revenueHt)} HT
        </text>
        <text x={cx} y={cy + 18} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
          {nightsLabel}
        </text>
      </g>
    );
  };

  const overduePayments = operational?.overdue.reservations || [];
  const overdueReservationsCount = operational?.overdue.count || 0;
  const overdueTotalAmount = operational?.overdue.totalAmount || 0;
  const hasOverdue = overdueReservationsCount > 0;
  const activeTab = (!hasOverdue && financeViewTab === 'overdue') ? 'pending' : financeViewTab;
  const pendingPayments = operational?.pending.reservations || [];
  const pendingTotals = operational?.pending.totals || {};
  const upcomingReservations = operational?.upcoming.reservations || [];
  const upcomingTotals = operational?.upcoming.totals || {};

  // KPI cards — neutral « Maison » tiles (2026-07-16 decision): white card, muted kpiLabel + tabular
  // kpiValue, thin semantic left accent (no more full-color backgrounds).
  // The three turnover cards carry the nights sold per logement; « Encaissé » / « En attente » are
  // subsets of échéances, not sets of stays, so they carry none (spec §3.4 rules 18-19).
  const yearCards = summary ? [
    { metric: 'yearToDate', label: 'Revenus', caption: "depuis le début de l'exercice jusqu'à aujourd'hui", value: summary.yearToDate, valueHt: summary.yearToDateHt, nights: nightsLine(summary.yearToDateByProperty), accent: 'info.main' },
    { metric: 'yearTotal', label: 'Revenu total', caption: "sur l'exercice", value: summary.yearTotal, valueHt: summary.yearTotalHt, nights: nightsLine(summary.yearTotalByProperty), accent: 'primary.main' },
  ] : [];
  const periodCards = summary ? [
    // The period's nights live in the « Revenu par logement » chart, not on this card (2026-08-12
    // decision — the chart already splits the period per logement, so the card stays a single figure).
    { metric: 'revenueTotal', label: 'Revenu total', caption: 'sur la période', value: summary.revenueTotal, valueHt: summary.revenueTotalHt, accent: 'primary.main' },
    { metric: 'totalCollected', label: 'Encaissé', value: summary.totalCollected, valueHt: summary.totalCollectedHt, accent: 'success.main' },
    // specs/finance-pending-global-remaining.md — period-free figure (every finished stay's restant dû).
    { metric: 'totalPending', label: 'En attente de règlement', caption: 'séjours terminés', value: summary.totalPending, valueHt: summary.totalPendingHt, accent: 'warning.main' },
  ] : [];

  const renderCard = (c, size) => (
    <Grid key={c.label} size={size}>
      <Card
        onClick={() => setBreakdownMetric(c.metric)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBreakdownMetric(c.metric); } }}
        role="button"
        tabIndex={0}
        aria-label={`Voir le détail : ${c.label}`}
        sx={{ height: '100%', cursor: 'pointer', borderLeft: '3px solid', borderColor: c.accent, transition: 'transform .1s, box-shadow .1s', '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 } }}
      >
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>
            {c.label}
            {c.caption && <Typography component="span" variant="caption" sx={{ ml: 0.5, fontWeight: 400 }}>{c.caption}</Typography>}
          </Typography>
          <Typography variant="kpiValue" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', my: 1 }}>{formatCurrencyRounded(c.value)}</Typography>
          {c.nights && (
            <Typography variant="caption" color="text.secondary">{c.nights}</Typography>
          )}
          {c.valueHt != null && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', ...TABULAR }}>{formatCurrencyRounded(c.valueHt)} HT</Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  );

  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider', ...TABULAR };

  const projectionCard = (
    <Accordion defaultExpanded={false} sx={{ mb: 3 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="sectionHeader">Projection à une date</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ mb: 2 }}>
          <TextField type="date" value={projectionDate} onChange={e => setProjectionDate(e.target.value)} size="small" slotProps={{ inputLabel: { shrink: true } }} />
        </Box>
        {projection && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>Total de séjour d'ici cette date</Typography>
                <Typography variant="kpiValue">{formatCurrencyRounded(projection.total)}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>Déjà encaissé</Typography>
                <Typography variant="kpiValue">{formatCurrencyRounded(projection.collected)}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>En attente</Typography>
                <Typography variant="kpiValue">{formatCurrencyRounded(projection.pending)}</Typography>
              </Grid>
            </Grid>
            {projection.details.length === 0 ? (
              <EmptyState message="Aucune réservation d'ici cette date." py={3} />
            ) : (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 760 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Encaissé</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="center">État</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projection.details.map((d) => (
                      <TableRow key={d.reservationId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${d.reservationId}`)}>
                        <TableCell>{d.clientName}</TableCell>
                        <TableCell>{d.propertyName}</TableCell>
                        <TableCell>{displayDate(d.startDate)} → {displayDate(d.endDate)}</TableCell>
                        <TableCell align="right" sx={TABULAR}>{formatCurrency(d.collected)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(d.totalSejour)}</TableCell>
                        <TableCell align="center">
                          <StatusBadge status={d.settled ? 'success' : 'warning'} label={d.settled ? 'Réglé' : 'En attente'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} sx={footerCellSx}>Total</TableCell>
                      <TableCell align="right" sx={footerCellSx}>{formatCurrency(projection.collected)}</TableCell>
                      <TableCell align="right" sx={footerCellSx}>{formatCurrency(projection.total)}</TableCell>
                      <TableCell sx={footerCellSx} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );

  return (
    <Box>
      <PageActionBar
        title="Suivi financier"
        actionsBefore={[
          { icon: <SyncIcon />, tooltip: 'Actualiser', onClick: refreshAll, color: 'info' },
        ]}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1240, mx: 'auto' }}>
        {loadError && <ErrorAlert message="Impossible de charger les données financières." onRetry={refreshAll} sx={{ mb: 2 }} />}
        {!summary && !loadError && <LoadingState label="Chargement du suivi financier…" />}

        {/* Row 0 — exercise selector. Deliberately NOT in PageActionBar.center, which is hidden on xs
            (specs/fiscal-year-and-nights-sold.md §6.3); it is a filter, not an action. */}
        {summary?.fiscalYear && (
          <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 2 }, mb: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' } }}>
            <TextField
              select
              size="small"
              label="Exercice"
              value={summary.fiscalYear.key}
              onChange={(e) => setSelectedFiscalYear(e.target.value)}
              sx={{ minWidth: { sm: 200 } }}
            >
              {(summary.fiscalYears || []).map((fy) => (
                <MenuItem key={fy.key} value={fy.key}>
                  {fy.label}{fy.isCurrent ? ' (en cours)' : ''}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              du {displayDate(summary.fiscalYear.from)} au {displayDate(summary.fiscalYear.to)}
            </Typography>
          </Box>
        )}
        {/* Row 1 — exercise cards at the very top (independent of the selected period). */}
        {summary && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {yearCards.map((c) => renderCard(c, { xs: 12, sm: 6 }))}
          </Grid>
        )}
        {/* Period selector — drives the period cards + charts below it. */}
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField label="Du" type="date" value={from} onChange={e => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Au" type="date" value={to} onChange={e => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </CardContent>
        </Card>
        {/* Row 2 — period cards (depend on the du/au range). */}
        {summary && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {periodCards.map((c) => renderCard(c, { xs: 12, sm: 4 }))}
          </Grid>
        )}
        {/* Charts */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="sectionHeader">Revenu par logement</Typography>
                <Tabs value={chartTab} onChange={(_, nextTab) => setChartTab(nextTab)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 1 }}>
                  <Tab value="period" label="Sur la période" />
                  <Tab value="year" label="Depuis le début de l'exercice" />
                </Tabs>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {chartTab === 'period'
                    ? `Période du ${displayDate(from)} au ${displayDate(to)} · montants TTC`
                    // Bounds come from the payload — the client never derives an exercise itself.
                    : `Exercice ${summary?.fiscalYear?.label || ''} · depuis le ${displayDate(summary?.fiscalYear?.from)} · montants TTC`}
                </Typography>
                {barData.length === 0 ? (
                  <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <EmptyState
                      message={chartTab === 'period' ? 'Aucun revenu sur la période sélectionnée.' : "Aucun revenu depuis le début de l'année."}
                      py={2}
                    />
                  </Box>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <RechartsTooltip formatter={(value, name, item) => `${formatCurrencyRounded(value)} (${formatCurrencyRounded(item?.payload?.revenueHt || 0)} HT) · ${item?.payload?.nights || 0} nuit${(item?.payload?.nights || 0) > 1 ? 's' : ''}`} />
                      <Bar dataKey="revenue" fill={theme.palette.primary.main} name="Total de séjour" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="revenue" content={renderBarLabel} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="sectionHeader" gutterBottom>Répartition</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" labelLine={false} label={renderPieLabel}>
                      {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Pie>
                    <Legend />
                    <RechartsTooltip formatter={(value) => formatCurrencyRounded(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
        <Divider sx={{ my: 3 }} />
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' }, gap: 1.5 }}>
              <Typography variant="sectionHeader">Suivi opérationnel</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Chip size="small" color={overdueReservationsCount > 0 ? 'error' : 'success'} label={`${overdueReservationsCount} retard${overdueReservationsCount > 1 ? 's' : ''}`} />
                <Chip size="small" color={overdueTotalAmount > 0 ? 'error' : 'success'} label={`Retard total: ${formatCurrency(overdueTotalAmount)}`} />
                <Chip size="small" label={`En attente: ${pendingPayments.length}`} />
                <Chip size="small" label={`À venir: ${upcomingReservations.length}`} />
                <Chip size="small" label={`Période: ${(summary?.reservations || []).length}`} />
              </Box>
            </Box>

            <Tabs
              value={activeTab}
              onChange={(_, nextTab) => setFinanceViewTab(nextTab)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ mt: 1.5, mb: 2 }}
            >
              {hasOverdue && <Tab value="overdue" label="Paiements en retard" />}
              <Tab value="pending" label="Paiements en attente" />
              <Tab value="upcoming" label="Réservations à venir" />
              <Tab value="period" label="Réservations période" />
            </Tabs>

            {activeTab === 'overdue' && (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 920 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Éléments en retard</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Montant en retard</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {overduePayments.map((r) => (
                      <TableRow key={`overdue-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                        <TableCell>{r.firstName} {r.lastName}</TableCell>
                        <TableCell>{r.propertyName}</TableCell>
                        <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {r.depositOverdue && (
                              <Chip size="small" color="error" label={`Acompte: ${formatCurrency(r.depositAmount)} (échu ${displayDate(r.depositDueDate)})`} />
                            )}
                            {r.balanceOverdue && (
                              <Chip size="small" color="error" label={`Solde: ${formatCurrency(r.balanceAmount)} (échu ${displayDate(r.balanceDueDate)})`} />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'error.main', fontWeight: 700, ...TABULAR }}>{formatCurrency(r.overdueAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                      <TableCell align="right" sx={{ ...footerCellSx, color: 'error.main' }}>{formatCurrency(overdueTotalAmount)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            )}

            {activeTab === 'pending' && (
              pendingPayments.length === 0 ? (
                <EmptyState message="Aucun paiement en attente." py={3} />
              ) : (
                <>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <StatusBadge status="success" label={`En attente de paiement : ${formatCurrency(pendingTotals.remainingToPay)}`} />
                </Box>
                <OperationalPaymentsTable
                  rows={pendingPayments}
                  totals={pendingTotals}
                  interactive
                  showEndOfStayComplement
                  onTogglePayment={handleTogglePayment}
                  onSettleAll={handleSettleAll}
                  onOpenReservation={(id) => navigate(`/reservations/${id}`)}
                  minWidth={1180}
                />
                </>
              )
            )}

            {/* « Réservations à venir » — same payments table, read-only, without « Compl. fin de séjour ». */}
            {activeTab === 'upcoming' && (
              upcomingReservations.length === 0 ? (
                <EmptyState message="Aucune réservation à venir." py={3} />
              ) : (
                <>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <StatusBadge status="success" label={`En attente de paiement : ${formatCurrency(upcomingTotals.remainingToPay)}`} />
                </Box>
                <OperationalPaymentsTable
                  rows={upcomingReservations}
                  totals={upcomingTotals}
                  onOpenReservation={(id) => navigate(`/reservations/${id}`)}
                  minWidth={960}
                />
                </>
              )
            )}

            {activeTab === 'period' && (
              summary ? (
                <>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <StatusBadge status="neutral" label={`Période du ${displayDate(from)} au ${displayDate(to)}`} />
                </Box>
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 920 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Dates</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Suivi paiement</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.reservations.map((r) => (
                        <TableRow key={`period-${r.id}`} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/reservations/${r.id}`)}>
                          <TableCell>{r.firstName} {r.lastName}</TableCell>
                          <TableCell>{r.propertyName}</TableCell>
                          <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                          <TableCell><PlatformChip platform={r.platform} /></TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(r.totalSejour)}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                              {/* settled honours caisse interne (§3.6). */}
                              <Chip label={r.settled ? 'Réglé' : `Reste ${formatCurrency(r.remainingDue)}`} size="small" color={r.settled ? 'success' : 'warning'} />
                              {r.depositDisabled ? (
                                <Chip label="Acompte désactivé" size="small" variant="outlined" sx={{ fontStyle: 'italic' }} />
                              ) : (
                                <Chip
                                  label={`Acompte ${r.depositPaid ? 'payé' : 'non payé'}${r.depositDueDate && !r.depositPaid ? ` (${displayDate(r.depositDueDate)})` : ''}`}
                                  size="small"
                                  color={r.depositPaid ? 'success' : 'default'}
                                  variant={r.depositPaid ? 'filled' : 'outlined'}
                                />
                              )}
                              <Chip
                                label={`Solde ${r.balancePaid ? 'payé' : 'non payé'}${r.balanceDueDate && !r.balancePaid ? ` (${displayDate(r.balanceDueDate)})` : ''}`}
                                size="small"
                                color={r.balancePaid ? 'success' : 'default'}
                                variant={r.balancePaid ? 'filled' : 'outlined'}
                              />
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                        <TableCell align="right" sx={footerCellSx}>{formatCurrency(summary.revenueTotal)}</TableCell>
                        <TableCell sx={footerCellSx} />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </TableContainer>
                </>
              ) : (
                <EmptyState message="Aucune donnée disponible sur cette période." py={3} />
              )
            )}
          </CardContent>
        </Card>
        {/* Projection moved to the very end of the page. */}
        {projectionCard}
      </Box>

      {/* Breakdown of a clicked card figure — the reservations behind the amount. */}
      <FinanceBreakdownDialog
        open={!!breakdownMetric}
        metric={breakdownMetric}
        from={from}
        to={to}
        fiscalYear={summary?.fiscalYear?.key}
        onClose={() => setBreakdownMetric(null)}
        onOpenReservation={(id) => navigate(`/reservations/${id}`)}
      />
    </Box>
  );
}
