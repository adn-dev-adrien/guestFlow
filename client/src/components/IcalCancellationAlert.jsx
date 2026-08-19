/**
 * IcalCancellationAlert — Dashboard approval card for iCal reservations whose UID has
 * fallen out of every source feed (specs/ical-cancellation-approval.md §6.1).
 *
 * Self-contained: fetches its own list on mount + on every route change, then renders one
 * orange `<Alert>` listing every pending cancellation. Each card offers three actions:
 *   - "Supprimer" (color="error") → asks whether the platform owes an indemnity for the cancelled
 *                                   stay (specs/cancellation-compensation.md §3.2), then deletes
 *                                   the reservation server-side + ack, recording the compensation
 *                                   in the same transaction when one is declared.
 *   - "Voir la fiche"             → opens the reservation page without acknowledging.
 *   - ✕ (top-right)               → ignores the proposal; the reservation stays.
 *
 * Optimistic UI: rejecting removes the row immediately, then the POST is fired; on server error the
 * row is re-inserted at its original position. Approving waits for the dialog + the POST, because
 * the compensation must be persisted before the card disappears.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Button, IconButton, Tooltip, Divider, Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router';
import api from '../api';
import CancellationCompensationDialog from './CancellationCompensationDialog';
import { useToast } from './DialogProvider';
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
  const { showSuccess, showError } = useToast();
  const [alerts, setAlerts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  // The alert being approved, i.e. the one whose compensation question is on screen.
  const [pendingApproval, setPendingApproval] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getIcalCancellationAlert();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Step 1 — open the « indemnité attendue ? » question. Nothing is deleted yet.
  const handleApprove = useCallback((alert) => {
    if (!alert.reservationExists) return;
    setPendingApproval(alert);
  }, []);

  // Step 2 — the operator answered: `compensation` is null (no indemnity) or the declared block.
  // The row leaves the list only once the server confirmed, since the compensation is created in
  // the same transaction as the deletion.
  const handleApprovalSubmit = useCallback(async (compensation) => {
    const alert = pendingApproval;
    if (!alert) return;
    setBusyId(alert.id);
    try {
      await api.approveIcalCancellation(alert.id, compensation);
      setAlerts((rows) => rows.filter((r) => r.id !== alert.id));
      setPendingApproval(null);
      showSuccess(compensation
        ? 'Réservation supprimée — indemnité en attente de versement.'
        : 'Réservation supprimée.');
      // The pending-compensation alert lives in a sibling component; a single event keeps them in
      // sync without lifting this self-contained state into the Dashboard.
      if (compensation) window.dispatchEvent(new CustomEvent('guestflow:compensations-changed'));
    } catch (err) {
      showError(err.message || 'Suppression impossible.');
    } finally {
      setBusyId(null);
    }
  }, [pendingApproval, showSuccess, showError]);

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
    <>
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
    <CancellationCompensationDialog
      open={Boolean(pendingApproval)}
      mode="ask"
      busy={busyId === (pendingApproval && pendingApproval.id)}
      context={pendingApproval ? {
        clientName: pendingApproval.clientName,
        propertyName: pendingApproval.propertyName,
        platform: pendingApproval.sourceName,
        startDate: pendingApproval.startDate,
        endDate: pendingApproval.endDate,
      } : {}}
      onClose={() => setPendingApproval(null)}
      onSubmit={handleApprovalSubmit}
    />
    </>
  );
}
