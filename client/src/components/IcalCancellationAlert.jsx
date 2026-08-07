/**
 * IcalCancellationAlert — Dashboard approval card for iCal reservations whose UID has
 * fallen out of every source feed (specs/ical-cancellation-approval.md §6.1).
 *
 * Self-contained: fetches its own list on mount + on every route change, then renders one
 * orange `<Alert>` listing every pending cancellation. Each card offers three actions:
 *   - "Supprimer" (color="error") → deletes the reservation server-side + ack.
 *   - "Voir la fiche"             → opens the reservation page without acknowledging.
 *   - ✕ (top-right)               → ignores the proposal; the reservation stays.
 *
 * Optimistic UI: clicking Approve or Reject removes the row immediately, then the POST
 * is fired. On server error the row is re-inserted at its original position.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Button, IconButton, Tooltip, Divider, Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { displayDateShort } from '../utils/formatters';

// Coarse relative-time formatting (presentation only — no business rules). Mirrors
// `IcalDateDriftAlert.relativeFromNow`.
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

export default function IcalCancellationAlert() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getIcalCancellationAlert();
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
      await api.approveIcalCancellation(alert.id);
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
      await api.rejectIcalCancellation(alert.id);
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
        Annulations iCal — {alerts.length} réservation{alerts.length > 1 ? 's' : ''} à valider
      </AlertTitle>
      <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mt: 1 }}>
        {alerts.map((alert) => (
          <Box key={alert.id} sx={{ position: 'relative', pr: 5 }}>
            <Tooltip title="Ignorer cette annulation">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handleReject(alert)}
                  disabled={busyId === alert.id}
                  sx={{ position: 'absolute', top: 0, right: 0 }}
                  aria-label="Ignorer cette annulation"
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
              Du <strong>{displayDateShort(alert.startDate)}</strong> au <strong>{displayDateShort(alert.endDate)}</strong>
              {alert.sourceName ? <> · Source : <strong>{alert.sourceName}</strong></> : null}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Détecté {relativeFromNow(alert.detectedAt)}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => handleApprove(alert)}
                disabled={busyId === alert.id || !alert.reservationExists}
              >
                Supprimer
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
