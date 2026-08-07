/**
 * IcalDateDriftAlert — Dashboard approval card for iCal-locked reservations whose source
 * platform has proposed new dates (specs/ical-sync-override-locked-dates.md §6.1).
 *
 * Self-contained: fetches its own list on mount + on every route change, then renders one
 * orange `<Alert>` listing every pending drift. Each card offers three actions:
 *   - "Approuver" (color="success") → applies the narrow date override on the reservation.
 *   - "Voir la fiche"               → opens the reservation page without acknowledging.
 *   - ✕ (top-right)                 → ignores the proposal (rejects).
 *
 * Optimistic UI: clicking Approve or Reject removes the row immediately, then the POST is
 * fired. On server error the row is re-inserted at its original position and a snackbar
 * surfaces the error (caught by the parent's request layer).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Button, IconButton, Tooltip, Divider, Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckIcon from '@mui/icons-material/Check';
import { useNavigate } from 'react-router';
import api from '../api';
import { displayDateShort } from '../utils/formatters';

// Relative-time formatting is purely presentational (no business rules), so it lives client-side
// per CLAUDE.md §6 / §7. Coarse buckets only — minute / heure / jour — to match French copy.
function relativeFromNow(iso) {
  if (!iso) return '';
  // SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC. Re-anchor as UTC.
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

export default function IcalDateDriftAlert() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getIcalDateDriftAlert();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleApprove = useCallback(async (alert) => {
    if (!alert.reservationExists) return;
    const previous = alerts;
    setBusyId(alert.id);
    setAlerts((rows) => rows.filter((r) => r.id !== alert.id));
    try {
      await api.approveIcalDateDrift(alert.id);
    } catch {
      setAlerts(previous);
    } finally {
      setBusyId(null);
    }
  }, [alerts]);

  const handleReject = useCallback(async (alert) => {
    const previous = alerts;
    setBusyId(alert.id);
    setAlerts((rows) => rows.filter((r) => r.id !== alert.id));
    try {
      await api.rejectIcalDateDrift(alert.id);
    } catch {
      setAlerts(previous);
    } finally {
      setBusyId(null);
    }
  }, [alerts]);

  if (alerts.length === 0) return null;

  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}
      icon={false}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        Modifications de dates iCal — {alerts.length} changement{alerts.length > 1 ? 's' : ''} à valider
      </AlertTitle>
      <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mt: 1 }}>
        {alerts.map((alert) => (
          <Box key={alert.id} sx={{ position: 'relative', pr: 5 }}>
            <Tooltip title="Ignorer cette modification">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleReject(alert)}
                  disabled={busyId === alert.id}
                  sx={{ position: 'absolute', top: 0, right: 0 }}
                  aria-label="Ignorer cette modification"
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {alert.clientName}
              {alert.propertyName ? ` · ${alert.propertyName}` : ''}
              {!alert.reservationExists && (
                <Typography component="span" variant="caption" color="error" sx={{ ml: 1 }}>
                  (réservation supprimée)
                </Typography>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dates actuelles : <strong>{displayDateShort(alert.previousStartDate)} → {displayDateShort(alert.previousEndDate)}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dates proposées : <strong>{displayDateShort(alert.newStartDate)} → {displayDateShort(alert.newEndDate)}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Détecté {relativeFromNow(alert.detectedAt)}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={<CheckIcon />}
                onClick={() => handleApprove(alert)}
                disabled={busyId === alert.id || !alert.reservationExists}
              >
                Approuver
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                onClick={() => navigate(`/reservations/${alert.reservationId}`)}
                disabled={!alert.reservationExists}
              >
                Voir la fiche
              </Button>
            </Box>
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
