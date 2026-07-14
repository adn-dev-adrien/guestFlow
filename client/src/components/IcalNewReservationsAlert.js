/**
 * IcalNewReservationsAlert — Dashboard notification card listing the reservations imported via
 * iCal during the current day (specs/dashboard-ical-new-reservations.md).
 *
 * Self-contained: fetches its own list on mount + on every route change, renders one blue
 * (`info`) `<Alert>` with one CLICKABLE row per reservation that navigates to its reservation
 * page. Read-only — no approve/reject/dismiss (the list auto-rolls at UTC midnight). Renders
 * nothing when there is no import today, or on fetch error (a dashboard card must never break
 * the page). Mirrors the IcalCancellationAlert / IcalDateDriftAlert pattern.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Divider, Stack,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { displayDateShort } from '../utils/formatters';

// Coarse relative-time formatting (presentation only). Mirrors the sibling iCal alert cards.
function relativeFromNow(iso) {
  if (!iso) return '';
  const utc = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return '';
  const deltaSec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (deltaSec < 60) return 'il y a quelques instants';
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export default function IcalNewReservationsAlert() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getIcalNewReservationsToday();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (alerts.length === 0) return null;

  const open = (reservationId) => navigate(`/reservations/${reservationId}`);

  return (
    <Alert
      severity="info"
      variant="outlined"
      sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}
      icon={false}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        Nouvelles réservations iCal — {alerts.length} importée{alerts.length > 1 ? 's' : ''} aujourd'hui
      </AlertTitle>
      <Stack divider={<Divider flexItem />} spacing={0.5} sx={{ mt: 1 }}>
        {alerts.map((alert) => (
          <Box
            key={alert.reservationId}
            role="button"
            tabIndex={0}
            onClick={() => open(alert.reservationId)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(alert.reservationId); } }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              cursor: 'pointer', borderRadius: 1, px: 1, py: 1, mx: -1,
              minHeight: 44,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {alert.clientName}
                {alert.propertyName ? ` · ${alert.propertyName}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Du <strong>{displayDateShort(alert.startDate)}</strong> au <strong>{displayDateShort(alert.endDate)}</strong>
                {alert.platformLabel ? <> · Source : <strong>{alert.platformLabel}</strong></> : null}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Importée {relativeFromNow(alert.createdAt)}
              </Typography>
            </Box>
            <ChevronRightIcon fontSize="small" color="action" />
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
