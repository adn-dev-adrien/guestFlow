/**
 * IntakeBanner — what the Booking page did to this fiche (specs/booking-extranet-intake.md rules 17–18),
 * at the top of the reservation page (slot `reservation.banners`).
 *
 * States, all decided server-side: `applied` (the fiche was filled; can be hidden) and `proposed` (the
 * fiche was already filled and differs: Appliquer / Ignorer). Renders nothing otherwise. A guest message
 * still unanswered on Booking is mentioned in both.
 *
 * Props:
 *   reservationId          number
 *   onReservationChanged   () => void   the fiche reloads after the server wrote it
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { api } from '../sdk';

const show = (value) => (value === null || value === undefined || value === '' ? 'vide' : String(value));

export default function IntakeBanner({ reservationId, onReservationChanged }) {
  const [intake, setIntake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getBookingIntakeForReservation(reservationId)
      .then((r) => setIntake(r && r.intake))
      .catch(() => setIntake(null));
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, reloadFiche) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (reloadFiche && onReservationChanged) onReservationChanged();
      load();
    } catch (err) {
      setError(err.message || 'Échec');
    } finally {
      setBusy(false);
    }
  };

  if (!intake) return null;

  const guestWaiting = intake.guestMessagePending && (
    <Typography variant="body2" sx={{ mt: 0.5 }}>Message client sans réponse sur Booking.</Typography>
  );
  const fullOnXs = { flex: { xs: '1 1 100%', sm: '0 0 auto' }, minHeight: 44 };

  if (intake.status === 'applied') {
    return (
      <Alert severity="success" sx={{ mb: 2 }} onClose={busy ? undefined : () => run(() => api.hideBookingIntake(intake.id), false)}>
        Rempli depuis l’extranet Booking le {intake.appliedLabel}.
        {guestWaiting}
      </Alert>
    );
  }

  if (intake.status === 'proposed') {
    const count = intake.differences.length;
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        La page Booking propose {count} valeur{count > 1 ? 's' : ''} différente{count > 1 ? 's' : ''} de la fiche.
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {intake.differences.map((d) => (
            <li key={d.field}><Typography variant="body2">{d.label} : {show(d.from)} → {show(d.to)}</Typography></li>
          ))}
        </Box>
        {guestWaiting}
        <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" disabled={busy} sx={fullOnXs} onClick={() => run(() => api.applyBookingIntake(intake.id), true)}>
            Appliquer
          </Button>
          <Button size="small" variant="outlined" color="inherit" disabled={busy} sx={fullOnXs} onClick={() => run(() => api.ignoreBookingIntake(intake.id), false)}>
            Ignorer
          </Button>
        </Stack>
        {error && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{error}</Typography>}
      </Alert>
    );
  }

  return null;
}
