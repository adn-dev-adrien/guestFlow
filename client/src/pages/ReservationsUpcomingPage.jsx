import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Box, Typography, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TodayIcon from '@mui/icons-material/Today';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import ReservationCard from '../components/ReservationCard';
import { useToast } from '../components/DialogProvider';
import api from '../api';
import Slot from '../plugins/sdk/Slot';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { withFrom } from '../utils/navigation';

const ORIGIN = '/reservations/upcoming';

// One day: its header (server label and count) and its cards. Memoised so a « prêt » tick re-renders
// that day only — with 500 stays, re-rendering every card held the box for ~0.7 s (rule 8).
const UpcomingDay = React.memo(function UpcomingDay({ day, onToggleReady, onOpenReservation, onOpenSas, onOpenClient }) {
  const { label, isToday, reservations, readyCount, total, allReady } = day;
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1,
          bgcolor: isToday ? 'primary.main' : allReady ? 'success.main' : 'grey.200',
          color: isToday || allReady ? 'common.white' : 'text.primary',
          borderRadius: 2, px: 2, py: 1,
        }}>
          <TodayIcon sx={{ fontSize: 20 }} />
          <Typography variant="sectionHeader" sx={{ textTransform: 'capitalize' }}>
            {label}{isToday && ' — Aujourd\'hui'}
          </Typography>
          <Chip
            label={`${readyCount}/${total}`}
            size="small"
            sx={(t) => ({ ml: 'auto', bgcolor: alpha(t.palette.common.white, 0.25), color: isToday || allReady ? 'common.white' : 'text.primary', fontWeight: 700, height: 22 })}
          />
        </Box>
      </Box>

      {reservations.map((r) => (
        <ReservationCard
          key={r.id}
          reservation={r}
          onToggleReady={onToggleReady}
          onOpenReservation={onOpenReservation}
          onOpenSas={onOpenSas}
          onOpenClient={onOpenClient}
        />
      ))}
    </Box>
  );
});

/**
 * « Réservations à venir » (dashboard → carte Réservations). Refactor 2026-06-17
 * (specs/upcoming-reservations-cards.md): the Planning arrival cards (ReservationCard) grouped by day,
 * over ALL future reservations. Render-only: ONE call returns the days already grouped, labelled and
 * counted, each reservation fully detailed (rule 6). Actions: open the fiche, run the arrival SAS,
 * open the client, toggle « prêt » — the box answers at once, then the server recounts that one day
 * (rule 8).
 */
export default function ReservationsUpcomingPage() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sas, setSas] = useState(null);
  // specs/plugins-phase-2-hosts.md rule 9 (gap 4) — the arrival SAS opens only while its plugin is active.
  const sasOn = usePlugin(SAS);

  const loadUpcoming = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await api.getUpcomingReservations();
      setDays((payload && payload.days) || []);
    } catch {
      setDays([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  const openReservation = useCallback((id) => { if (id) navigate(withFrom(`/reservations/${id}`, ORIGIN)); }, [navigate]);
  const openArrivalSas = useCallback((id) => { if (id) setSas({ reservationId: id, mode: 'arrival' }); }, []);
  const openClient = useCallback((clientId) => { if (clientId) navigate(withFrom(`/clients?clientId=${clientId}`, ORIGIN)); }, [navigate]);

  // Rule 8: the box flips at once; the day's count stays the server's — that one day is asked again.
  // A slower answer for the same day than a later click's is dropped.
  const dayRequests = useRef(new Map());
  // Only the touched day gets a new object: the other days (memoised) do not re-render.
  const setReady = useCallback((id, checkInReady) => {
    setDays((prev) => prev.map((day) => (day.reservations.some((r) => r.id === id)
      ? { ...day, reservations: day.reservations.map((r) => (r.id === id ? { ...r, checkInReady } : r)) }
      : day)));
  }, []);

  const handleToggleReady = useCallback(async (r) => {
    const next = !r.checkInReady;
    const date = r.startDate;
    const ticket = (dayRequests.current.get(date) || 0) + 1;
    dayRequests.current.set(date, ticket);
    setReady(r.id, next);
    try {
      await api.markPayment(r.id, { checkInReady: next });
    } catch (e) {
      setReady(r.id, r.checkInReady);
      showError(e.message || 'Impossible de mettre à jour le statut.');
      return;
    }
    try {
      const payload = await api.getUpcomingReservations(date);
      if (dayRequests.current.get(date) !== ticket) return;
      const fresh = ((payload && payload.days) || []).find((d) => d.date === date);
      setDays((prev) => (fresh ? prev.map((d) => (d.date === date ? fresh : d)) : prev.filter((d) => d.date !== date)));
    } catch {
      // The tick is saved; the count catches up on the next load.
    }
  }, [showError, setReady]);

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
        <ErrorAlert message="Impossible de charger les réservations à venir." onRetry={() => loadUpcoming()} sx={{ mb: 3 }} />
      )}

      {!loading && !loadError && days.length === 0 && (
        <EmptyState message="Aucune réservation à venir." />
      )}

      {days.map((day) => (
        <UpcomingDay
          key={day.date}
          day={day}
          onToggleReady={handleToggleReady}
          onOpenReservation={openReservation}
          onOpenSas={sasOn ? openArrivalSas : undefined}
          onOpenClient={openClient}
        />
      ))}

      <Slot
        name="sas.dialog"
        open={!!sas}
        reservationId={sas?.reservationId}
        mode={sas?.mode || 'arrival'}
        onClose={() => setSas(null)}
        onDone={() => { setSas(null); loadUpcoming(); }}
      />
    </Box>
  );
}
