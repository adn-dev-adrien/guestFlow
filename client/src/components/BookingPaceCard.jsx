/**
 * BookingPaceCard — « Réservations à venir, à date » of the Suivi financier (specs/booking-pace.md):
 * the summary sentence and its badge, the metric toggle, the 7 / 30 days pickup, the month chart and,
 * on a click, that month's pickup curve. Every figure and sentence comes from `/finance/pace`; the card
 * only formats numbers with their unit. Feature-local.
 *
 * Props:
 *   propertyId: string   the page's logement filter ('' = all)
 *   refreshKey: number   bumped by the page's refresh action
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Card, CardContent, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import YearOverYearBadge from './YearOverYearBadge';
import PaceMonthChart, { SAND, GHOST_STROKE } from './PaceMonthChart';
import PickupCurveChart from './PickupCurveChart';
import { formatCurrencyRounded } from '../utils/formatters';
import api from '../api';

const METRICS = [
  { value: 'reservations', label: 'Réservations' },
  { value: 'nights', label: 'Nuits' },
  { value: 'revenue', label: 'CA des nuits' },
];

const CAPTIONS = {
  reservations: "Une réservation compte dans son mois d'arrivée.",
  nights: 'Chaque nuit compte dans le mois où elle tombe.',
  revenue: "CA des nuits : le total de séjour réparti sur ses nuits. Ce n'est pas le « Revenu par mois », qui suit la date d'encaissement.",
};

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const THOUSANDS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const plural = (n, one, many) => `${NUMBER.format(n)} ${Math.abs(n) > 1 ? many : one}`;

export function paceFormatters(metric) {
  const formatValue = (v) => {
    if (metric === 'revenue') return formatCurrencyRounded(v);
    return metric === 'nights' ? plural(v, 'nuit', 'nuits') : plural(v, 'réservation', 'réservations');
  };
  const formatShort = (v) => (metric === 'revenue' && Math.abs(v) >= 1000 ? `${THOUSANDS.format(v / 1000)} k` : NUMBER.format(v));
  return { formatValue, formatShort };
}

const signed = (v, format) => `${v < 0 ? '−' : '+'}${format(Math.abs(v))}`;

function PickupChip({ label, figure, formatValue }) {
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 190, border: 1, borderColor: 'divider', borderRadius: '10px', px: 1.5, py: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ fontWeight: 700, fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums' }}>
        {signed(figure.current, formatValue)}
        {figure.lastYear != null && (
          <Box component="span" sx={{ fontWeight: 400, fontSize: 12.5, color: 'text.secondary' }}> · l'an dernier {signed(figure.lastYear, formatValue)}</Box>
        )}
      </Box>
    </Box>
  );
}

function LegendItem({ swatch, label }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box component="span" sx={{ width: 11, height: 11, borderRadius: '3px', ...swatch }} />{label}
    </Box>
  );
}

export default function BookingPaceCard({ propertyId, refreshKey }) {
  const theme = useTheme();
  const [metric, setMetric] = useState('reservations');
  const [pace, setPace] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [curve, setCurve] = useState({ data: null, error: false });

  const load = useCallback(async () => {
    try {
      setError(null);
      setPace(await api.getFinancePace({ propertyId, metric }));
    } catch (err) {
      setError((err && err.error) || 'Impossible de charger les réservations à date.');
    }
  }, [propertyId, metric, refreshKey]);

  const loadCurve = useCallback(async () => {
    if (!selected) return;
    try {
      setCurve({ data: await api.getFinancePaceMonth(selected, { propertyId, metric }), error: false });
    } catch {
      setCurve({ data: null, error: true });
    }
  }, [selected, propertyId, metric, refreshKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCurve(); }, [loadCurve]);

  const { formatValue, formatShort } = paceFormatters(metric);
  const selectMonth = (month) => {
    setCurve({ data: null, error: false });
    setSelected((current) => (current === month ? null : month));
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="sectionHeader">Réservations à venir, à date</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              12 prochains mois de séjour, comparés à l'an dernier à la même date · cliquez un mois pour sa montée en charge
            </Typography>
          </Box>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={metric}
            aria-label="Mesure"
            onChange={(_, next) => { if (next) setMetric(next); }}
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, minHeight: 36 } }}
          >
            {METRICS.map((m) => <ToggleButton key={m.value} value={m.value}>{m.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>

        {error && <ErrorAlert message={error} onRetry={load} sx={{ mt: 2 }} />}
        {!error && !pace && <LoadingState py={4} />}
        {!error && pace && (
          <>
            <Box sx={{ mt: 1.75, mb: 1, fontSize: 15, lineHeight: 1.5 }}>
              {pace.summary.text}{' '}
              <YearOverYearBadge change={pace.summary.change} />
            </Box>
            {pace.summary.notice && (
              <Box sx={{ bgcolor: '#E4EDF3', color: 'info.main', borderRadius: '10px', px: 1.5, py: 1, fontSize: 13, mb: 1 }}>
                {pace.summary.notice}
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 1.25, flexDirection: { xs: 'column', sm: 'row' }, my: 1.25 }}>
              <PickupChip label="Pris ces 7 derniers jours" figure={pace.pickup.last7} formatValue={formatValue} />
              <PickupChip label="Pris ces 30 derniers jours" figure={pace.pickup.last30} formatValue={formatValue} />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', my: 1 }}>
              <LegendItem swatch={{ bgcolor: theme.palette.primary.main }} label="Cette année, à date" />
              <LegendItem swatch={{ bgcolor: SAND }} label="L'an dernier à la même date" />
              <LegendItem swatch={{ border: `1.5px dashed ${GHOST_STROKE}` }} label="L'an dernier, au final" />
            </Box>
            <PaceMonthChart months={pace.months} selected={selected} onSelectMonth={selectMonth} formatValue={formatValue} formatShort={formatShort} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{CAPTIONS[metric]}</Typography>

            {selected && (
              <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 1.5, pt: 1.5 }}>
                {curve.error && <ErrorAlert message="Impossible de charger la montée en charge." onRetry={loadCurve} />}
                {!curve.error && !curve.data && <LoadingState py={3} />}
                {curve.data && (
                  <>
                    <Typography variant="subtitle2" sx={{ textTransform: 'none' }}>
                      Montée en charge · {curve.data.label.charAt(0).toUpperCase() + curve.data.label.slice(1)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Cumul réservé selon le nombre de jours avant le 1er du mois · aujourd'hui : J-{curve.data.todayDaysBefore}
                    </Typography>
                    <PickupCurveChart curve={curve.data} formatValue={formatValue} formatShort={formatShort} />
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                      <LegendItem swatch={{ bgcolor: theme.palette.primary.main, height: 3 }} label="Cette année" />
                      <LegendItem swatch={{ borderTop: `2px dashed ${GHOST_STROKE}`, height: 0, borderRadius: 0 }} label="L'an dernier" />
                      <LegendItem swatch={{ bgcolor: theme.palette.secondary.main, width: 3 }} label="Aujourd'hui" />
                    </Box>
                  </>
                )}
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
