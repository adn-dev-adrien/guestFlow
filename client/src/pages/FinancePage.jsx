// Suivi financier — one dashboard, one window (specs/finance-dashboard-redesign.md). The page renders
// the server's `/finance/dashboard` payload and, for the tile that is open, its detail table: every
// figure, total, ratio and French sentence comes ready-made. Local state is the URL (window + logement)
// and which tile is open.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Box, Card, CardContent, Grid, MenuItem, TextField, Typography } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import PeriodSelector from '../components/PeriodSelector';
import ChoiceCardStrip from '../components/ChoiceCardStrip';
import InsightCard from '../components/InsightCard';
import SelectableTile from '../components/SelectableTile';
import FinanceHero from '../components/FinanceHero';
import FinanceDetailPanel from '../components/FinanceDetailPanel';
import MonthlyRevenueChart from '../components/MonthlyRevenueChart';
import SmallMultiplesLineChart from '../components/SmallMultiplesLineChart';
import BookingPaceCard from '../components/BookingPaceCard';
import { formatCurrencyRounded } from '../utils/formatters';
import api from '../api';

const DETAIL_ID = 'finance-detail';
const percent = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const shortDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
const FORMAT = { amount: formatCurrencyRounded, percent, date: shortDate };
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const iso = (d) => d.toISOString().slice(0, 10);

// The tiles, in order, each with what its figure reads from `dashboard.tiles` (rule 13).
const TILES = [
  { key: 'collected', label: 'Encaissé', dot: 'success.main', read: (t) => [formatCurrencyRounded(t.amount), t.shareOfRevenue == null ? '' : `${percent(t.shareOfRevenue)} du chiffre d'affaires`] },
  { key: 'toCollect', label: 'À encaisser', dot: 'secondary.main', read: (t) => [formatCurrencyRounded(t.amount), `${plural(t.stays, 'séjour')} · tous exercices`] },
  { key: 'late', label: 'En retard', dot: 'error.main', read: (t) => [formatCurrencyRounded(t.amount), t.stays ? `${plural(t.stays, 'séjour')} · tous exercices` : 'rien à relancer'], alert: (t) => t.stays > 0 },
  { key: 'stays', label: 'Réservations', dot: 'info.main', read: (t) => [plural(t.count, 'séjour'), `${t.upcoming} à venir`] },
  { key: 'properties', label: 'Logements', dot: 'primary.main', read: (t) => (t.count === 1 && t.name ? [formatCurrencyRounded(t.revenue), `${t.revPar == null ? '—' : formatCurrencyRounded(t.revPar)} de RevPAR`] : [plural(t.count, 'logement'), t.leader ? `en tête : ${t.leader}` : '']) },
  { key: 'channels', label: 'Canaux', dot: '#6B8F76', read: (t) => [`− ${formatCurrencyRounded(t.commission)}`, 'commissions payées'] },
];

export default function FinancePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Rule 4 — the window and the logement live in the URL, so « back » from a reservation restores them.
  const params = {
    fiscalYear: searchParams.get('exercice') || '',
    period: searchParams.get('periode') || 'fy',
    month: searchParams.get('mois') || '',
    from: searchParams.get('du') || '',
    to: searchParams.get('au') || '',
    propertyId: searchParams.get('logement') || '',
  };
  const setParams = (next) => {
    const map = { fiscalYear: 'exercice', period: 'periode', month: 'mois', from: 'du', to: 'au', propertyId: 'logement' };
    const out = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => { if (v == null || v === '' || (k === 'period' && v === 'fy')) out.delete(map[k]); else out.set(map[k], String(v)); });
    setSearchParams(out, { replace: true });
  };
  const paramsKey = searchParams.toString();

  const [dashboard, setDashboard] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tile, setTile] = useState(null);
  const [detail, setDetail] = useState({ data: null, loading: false, error: false });
  const [staysScope, setStaysScope] = useState('window');
  const [until, setUntil] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return iso(d); });

  const loadDashboard = useCallback(async () => {
    try {
      setLoadError(null);
      setDashboard(await api.getFinanceDashboard(params));
    } catch (err) {
      setLoadError((err && err.error) || 'Impossible de charger les données financières.');
    }
  }, [paramsKey]);

  const loadDetail = useCallback(async () => {
    if (!tile) return;
    setDetail((d) => ({ ...d, loading: true, error: false }));
    try {
      const data = await api.getFinanceDashboardDetail(tile, { ...params, until, scope: staysScope });
      setDetail({ data, loading: false, error: false });
    } catch {
      setDetail({ data: null, loading: false, error: true });
    }
  }, [tile, paramsKey, until, staysScope]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const [paceRefresh, setPaceRefresh] = useState(0);
  const refreshAll = async () => {
    setPaceRefresh((n) => n + 1);
    await Promise.all([loadDashboard(), loadDetail()]);
  };

  const openTile = (key) => {
    setDetail({ data: null, loading: false, error: false });
    setTile((current) => (current === key ? null : key));
  };

  // Rule 15 — a payment ticked here is written through the reservation's payment endpoint, then every
  // figure is reloaded together.
  const [paymentError, setPaymentError] = useState(null);
  const markPayment = async (id, payload) => {
    setPaymentError(null);
    try {
      await api.markPayment(id, payload);
    } catch (e) {
      setPaymentError(e.message || 'Le paiement n\'a pas pu être enregistré.');
      return;
    }
    await refreshAll();
  };
  const handleTogglePayment = (reservation, field) => markPayment(reservation.id, { [field]: !reservation[field] });
  const handleSettleAll = async (r) => {
    const payload = {};
    if (!r.depositDisabled && Number(r.depositAmount || 0) > 0 && !r.depositPaid) payload.depositPaid = true;
    if (Number(r.balanceAmount || 0) > 0 && !r.balancePaid) payload.balancePaid = true;
    if (Number(r.complementAmount || 0) > 0 && !r.complementPaid) payload.complementPaid = true;
    if (Number(r.endOfStayComplementAmount || 0) > 0 && !r.endOfStayComplementPaid) payload.endOfStayComplementPaid = true;
    if (Object.keys(payload).length === 0) return;
    await markPayment(r.id, payload);
  };

  const d = dashboard;
  const selectedProperty = d && d.propertyId ? d.properties.find((p) => p.propertyId === d.propertyId) : null;
  const defaultMonth = () => {
    const now = new Date().toISOString().slice(0, 7);
    return d && d.months.some((m) => m.month === now) ? now : (d && d.months[0] ? d.months[0].month : now);
  };
  const defaultCustom = () => {
    const start = new Date(); start.setDate(1);
    const end = new Date(start); end.setMonth(end.getMonth() + 1, 0);
    return { from: iso(start), to: iso(end) };
  };

  return (
    <Box>
      <PageActionBar
        title="Suivi financier"
        actionsBefore={[{ icon: <SyncIcon />, tooltip: 'Actualiser', onClick: refreshAll, color: 'info' }]}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1240, mx: 'auto' }}>
        {loadError && <ErrorAlert message={loadError} onRetry={loadDashboard} sx={{ mb: 2 }} />}
        {!d && !loadError && <LoadingState label="Chargement du suivi financier…" />}
        {d && (
          <>
            {/* Toolbar — exercise + window (rules 1-2). A filter, so it stays in the page, visible on xs. */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
              <TextField select size="small" label="Exercice" value={d.fiscalYear.key} onChange={(e) => setParams({ fiscalYear: e.target.value, period: 'fy', month: '' })} sx={{ minWidth: 190 }}>
                {d.fiscalYears.map((fy) => <MenuItem key={fy.key} value={fy.key}>{fy.label}{fy.isCurrent ? ' (en cours)' : ''}</MenuItem>)}
              </TextField>
              <PeriodSelector
                kind={d.window.kind}
                month={d.window.month || params.month}
                from={params.from || defaultCustom().from}
                to={params.to || defaultCustom().to}
                months={d.months}
                onChange={(w) => {
                  if (w.kind === 'fy') setParams({ period: 'fy', month: '', from: '', to: '' });
                  else if (w.kind === 'month') setParams({ period: 'month', month: w.month || defaultMonth(), from: '', to: '' });
                  else setParams({ period: 'custom', month: '', from: w.from, to: w.to });
                }}
              />
            </Box>

            {/* Rule 12 — the logements strip filters everything below it. */}
            <ChoiceCardStrip
              ariaLabel="Logement"
              selected={d.propertyId}
              onSelect={(id) => setParams({ propertyId: id })}
              items={[
                { value: null, label: 'Tous les logements', figure: formatCurrencyRounded(d.totalRevenue), caption: `${percent(d.totalOccupancy)} occupé` },
                ...d.properties.map((p) => ({
                  value: p.propertyId, label: p.name, color: p.color, figure: formatCurrencyRounded(p.revenue),
                  caption: `${percent(p.occupancy)} occupé · ${p.revenuePerNight == null ? '—' : formatCurrencyRounded(p.revenuePerNight)}/nuit`,
                })),
              ]}
            />

            <FinanceHero
              hero={d.hero}
              windowLabel={d.window.label}
              asOf={d.window.asOf < d.window.to ? d.window.asOf : null}
              propertyName={selectedProperty ? selectedProperty.name : null}
              fiscalYearLabel={d.fiscalYear.label}
              format={FORMAT}
            />

            {d.insights.length > 0 && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                {d.insights.map((i) => (
                  <Grid key={i.key} size={{ xs: 12, md: 12 / d.insights.length }}>
                    <InsightCard tone={i.tone} title={i.title} text={i.text} />
                  </Grid>
                ))}
              </Grid>
            )}

            {/* Rule 13 — six tiles; the open one shows its table just below the row. */}
            <Grid container spacing={1.5}>
              {TILES.map((t) => {
                const [value, caption] = t.read(d.tiles[t.key]);
                return (
                  <Grid key={t.key} size={{ xs: 6, md: 4, xl: 2 }}>
                    <SelectableTile
                      label={t.label}
                      value={value}
                      caption={caption}
                      dotColor={t.dot}
                      valueColor={t.alert && t.alert(d.tiles[t.key]) ? 'error.main' : undefined}
                      selected={tile === t.key}
                      onClick={() => openTile(t.key)}
                      controls={DETAIL_ID}
                    />
                  </Grid>
                );
              })}
            </Grid>
            {paymentError && <ErrorAlert message={paymentError} sx={{ mt: 1.5 }} />}
            {tile ? (
              <FinanceDetailPanel
                id={DETAIL_ID}
                tile={tile}
                data={detail.data}
                loading={detail.loading}
                error={detail.error}
                onRetry={loadDetail}
                windowLabel={d.window.label}
                staysScope={staysScope}
                onStaysScopeChange={setStaysScope}
                until={until}
                onUntilChange={setUntil}
                onClose={() => setTile(null)}
                onOpenReservation={(id) => navigate(`/reservations/${id}`)}
                onTogglePayment={handleTogglePayment}
                onSettleAll={handleSettleAll}
                onSelectProperty={(id) => setParams({ propertyId: id })}
              />
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 2 }}>
                Cliquez sur une tuile pour afficher le tableau correspondant.
              </Typography>
            )}

            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 12, lg: 6 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="sectionHeader">Revenu par mois</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Exercice {d.fiscalYear.label}{d.window.kind !== 'fy' ? ' · la période choisie est surlignée' : ''}
                    </Typography>
                    <MonthlyRevenueChart
                      months={d.revenueMonths}
                      highlightWindow={d.window.kind !== 'fy'}
                      previousYear={d.fiscalYear.previousLabel}
                      formatAmount={formatCurrencyRounded}
                    />
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="sectionHeader">Taux d'occupation</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Nuits vendues ÷ nuits ouvrables, par mois · une couleur par logement
                    </Typography>
                    <SmallMultiplesLineChart
                      currentLabel={d.fiscalYear.label}
                      previousLabel={d.fiscalYear.previousLabel}
                      formatValue={percent}
                      series={d.occupancy.map((o) => ({
                        key: String(o.propertyId),
                        title: o.name,
                        color: o.color,
                        caption: o.average == null ? '—' : `moy. ${percent(o.average)}`,
                        points: o.months.map((m) => ({ key: m.month, tick: m.initial, label: m.label, current: m.current, previous: m.previous })),
                      }))}
                    />
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={12}>
                <BookingPaceCard propertyId={params.propertyId} refreshKey={paceRefresh} />
              </Grid>
            </Grid>
          </>
        )}
      </Box>
    </Box>
  );
}
