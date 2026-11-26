/**
 * PaymentsReceivedAlert — home card « Paiements reçus »: the online payments recorded on a stay during the last
 * 24 hours, one clickable line per payment (specs/payments/online-payment-notices.md rule 5).
 *
 * Self-contained like NewReservationsAlert: fetches its list on mount and every 5 minutes. The lines arrive
 * ready to render (guest, bucket, amount, time — all written by the server); a line opens the fiche. Renders
 * nothing when the list is empty or the fetch fails (a home card never breaks the page).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import api from '../api';
import AttentionCard from './AttentionCard';
import ReservationLinkLine from './ReservationLinkLine';

const REFRESH_MS = 5 * 60 * 1000;

export default function PaymentsReceivedAlert({ attention }) {
  const [alerts, setAlerts] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getPaymentsReceived();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (alerts.length === 0) return null;

  return (
    <AttentionCard attention={attention}>
      <Stack divider={<Divider flexItem />} spacing={0.5}>
        {alerts.map((alert, index) => (
          <ReservationLinkLine key={`${alert.reservationId}-${index}`} reservationId={alert.reservationId} clientName={alert.clientName}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0 }}>{alert.clientName}</Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{alert.amountLabel}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {alert.bucketLabel}
              {alert.propertyName ? ` · ${alert.propertyName}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">{alert.whenLabel}</Typography>
          </ReservationLinkLine>
        ))}
      </Stack>
    </AttentionCard>
  );
}
