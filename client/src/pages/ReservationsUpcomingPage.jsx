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
import { useToast } from '../components/DialogProvider';
import api from '../api';
import Slot from '../plugins/sdk/Slot';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';
import { withFrom } from '../utils/navigation';

const ORIGIN = '/reservations/upcoming';

/**
 * « Réservations à venir » (dashboard → carte Réservations). Refactor 2026-06-17
 * (specs/upcoming-reservations-cards.md): the Planning arrival cards (ReservationCard) grouped by day,
 * over ALL future reservations. Render-only: ONE call returns the days already grouped, labelled and
 * counted, each reservation fully detailed (rule 6). Actions: open the fiche, run the arrival SAS,
 * open the client, toggle « prêt ».
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

  // `quiet` refreshes in place (after a « prêt » toggle) instead of showing the loader again.
  const loadUpcoming = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
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

  // The day counts are the server's: after a toggle the page asks again rather than recounting.
  const handleToggleReady = useCallback(async (r) => {
    try {
      await api.markPayment(r.id, { checkInReady: !r.checkInReady });
      await loadUpcoming({ quiet: true });
    } catch (e) {
      showError(e.message || 'Impossible de mettre à jour le statut.');
    }
  }, [showError, loadUpcoming]);

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

      {days.map(({ date, label, isToday, reservations, readyCount, total, allReady }) => (
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
              onToggleReady={handleToggleReady}
              onOpenReservation={openReservation}
              onOpenSas={sasOn ? openArrivalSas : undefined}
              onOpenClient={openClient}
            />
          ))}
        </Box>
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
