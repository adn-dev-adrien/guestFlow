/**
 * PendingAlert — Dashboard lines for the Booking stays the iCal import created and nobody filled yet
 * (specs/booking-extranet-intake.md rules 21–24). The slot `dashboard.alerts` shows the ones arriving later
 * than a week; `UrgentPendingAlert` (slot `dashboard.alerts.urgent`) shows the others, higher on the page.
 * Renders nothing when there is none. Title, count and severity are the server's
 * (specs/shell-and-home-day-first.md rule 6), drawn by `AttentionCard`.
 *
 * Props:
 *   urgent     boolean   which half of the list this instance shows (default false)
 *   attention  the home's subject (`booking-intake` or `booking-intake-urgent`)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, displayDate, AttentionCard } from '../sdk';

export default function PendingAlert({ urgent = false, attention }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);

  const load = useCallback(() => {
    api.getBookingIntakePending().then((r) => setItems(Array.isArray(r) ? r : [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = items.filter((item) => Boolean(item.urgent) === urgent);
  if (shown.length === 0) return null;

  const dismiss = async (reservationId) => {
    try { await api.dismissBookingIntakePending(reservationId); } finally { load(); }
  };

  return (
    <AttentionCard attention={attention}>
      <Stack spacing={1.5}>
        {shown.map((item) => (
          <Stack key={item.reservationId} spacing={1}>
            <Typography variant="body2">
              {item.propertyName} · {displayDate(item.startDate)} → {displayDate(item.endDate)}
              {urgent ? ` · arrivée ${item.daysToArrival === 0 ? 'aujourd’hui' : `dans ${item.daysToArrival} jour${item.daysToArrival > 1 ? 's' : ''}`}` : ''}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
              <Button size="small" variant="outlined" component="a" href={item.extranetUrl} target="_blank" rel="noopener noreferrer" sx={{ minHeight: 44 }}>
                Ouvrir dans Booking
              </Button>
              <Button size="small" variant="outlined" color="inherit" sx={{ minHeight: 44 }} onClick={() => navigate(`/reservations/${item.reservationId}`)}>
                Ouvrir la fiche
              </Button>
              <Button size="small" color="inherit" sx={{ minHeight: 44 }} onClick={() => dismiss(item.reservationId)}>
                Pas une réservation Booking
              </Button>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </AttentionCard>
  );
}
