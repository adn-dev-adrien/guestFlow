import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Typography, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TodayIcon from '@mui/icons-material/Today';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import ReservationCard from '../components/ReservationCard';
import ReservationSasDialog from '../components/sas/ReservationSasDialog';
import { useToast } from '../components/DialogProvider';
import api from '../api';
import { withFrom } from '../utils/navigation';

const ORIGIN = '/reservations/upcoming';

// French weekday + date label for the day header (mirrors PlanningPage).
function frenchWeekday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * « Réservations à venir » (dashboard → carte Réservations). Refactor 2026-06-17
 * (specs/upcoming-reservations-cards.md): the plain table is replaced by the Planning arrival cards
 * (ReservationCard) grouped by day, over ALL future reservations (arrival ≥ today, no 30-day cap).
 * Render-only: fetches the list then each reservation's full detail (same source as the Planning), so
 * the cards show beds / famille / options / ressources / complément / caution. Actions: open the fiche,
 * run the arrival SAS, open the client, toggle « prêt ».
 */
export default function ReservationsUpcomingPage() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sas, setSas] = useState(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const loadUpcoming = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // All future arrivals — no upper bound (decision 2026-06-17). The list endpoint is filtered by
      // a far `to`; we keep arrivals whose startDate ≥ today and fetch each one's full detail.
      const list = await api.getReservations({ from: todayStr, to: '2099-12-31' });
      const arrivals = (list || []).filter((r) => r.startDate >= todayStr);
      const detailed = (await Promise.all(arrivals.map((r) => api.getReservation(r.id).catch(() => null)))).filter(Boolean);
      const byDate = {};
      for (const r of detailed) {
        if (!byDate[r.startDate]) byDate[r.startDate] = [];
        byDate[r.startDate].push(r);
      }
      const grouped = Object.keys(byDate).sort().map((date) => ({
        date,
        reservations: byDate[date].sort((a, b) => (a.checkInTime || '23:59').localeCompare(b.checkInTime || '23:59')),
      }));
      setDays(grouped);
    } catch {
      setDays([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [todayStr]);

  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  const openReservation = useCallback((id) => { if (id) navigate(withFrom(`/reservations/${id}`, ORIGIN)); }, [navigate]);
  const openArrivalSas = useCallback((id) => { if (id) setSas({ reservationId: id, mode: 'arrival' }); }, []);
  const openClient = useCallback((clientId) => { if (clientId) navigate(withFrom(`/clients?clientId=${clientId}`, ORIGIN)); }, [navigate]);

  const handleToggleReady = useCallback(async (r) => {
    const newReady = !r.checkInReady;
    try {
      await api.markPayment(r.id, { checkInReady: newReady });
      setDays((prev) => prev.map((day) => ({
        ...day,
        reservations: day.reservations.map((res) => (res.id === r.id ? { ...res, checkInReady: newReady } : res)),
      })));
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  }, [showError]);

  return (
    <Box>
      <PageActionBar
        title="Réservations à venir"
        titleOnXs
        subtitle={(
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
            Toutes les arrivées à partir d'aujourd'hui
          </Typography>
        )}
      />

      {loading && <LoadingState label="Chargement des réservations…" />}

      {!loading && loadError && (
        <ErrorAlert message="Impossible de charger les réservations à venir." onRetry={loadUpcoming} sx={{ mb: 3 }} />
      )}

      {!loading && !loadError && days.length === 0 && (
        <EmptyState message="Aucune réservation à venir." />
      )}

      {days.map(({ date, reservations }) => {
        const isToday = date === todayStr;
        const readyCount = reservations.filter((r) => r.checkInReady).length;
        const allReady = reservations.length > 0 && readyCount === reservations.length;
        return (
          <Box key={date} sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1,
                bgcolor: isToday ? 'primary.main' : allReady ? 'success.main' : 'grey.200',
                color: isToday || allReady ? 'common.white' : 'text.primary',
                borderRadius: 2, px: 2, py: 1,
              }}>
                <TodayIcon sx={{ fontSize: 20 }} />
                <Typography variant="sectionHeader" sx={{ textTransform: 'capitalize' }}>
                  {frenchWeekday(date)}{isToday && ' — Aujourd\'hui'}
                </Typography>
                <Chip
                  label={`${readyCount}/${reservations.length}`}
                  size="small"
                  sx={(t) => ({ ml: 'auto', bgcolor: alpha(t.palette.common.white, 0.25), color: isToday || allReady ? 'common.white' : 'text.primary', fontWeight: 700, height: 22 })}
                />
              </Box>
            </Box>

            {reservations.map((r) => (
              <ReservationCard
                key={r.id}
                reservation={r}
                onToggleReady={handleToggleReady}
                onOpenReservation={openReservation}
                onOpenSas={openArrivalSas}
                onOpenClient={openClient}
              />
            ))}
          </Box>
        );
      })}

      <ReservationSasDialog
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onCommitted={() => { setSas(null); loadUpcoming(); }}
      />
    </Box>
  );
}
