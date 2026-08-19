/**
 * CancellationCompensationsPendingAlert — Dashboard reminder for indemnities a platform owes us but
 * has not wired yet (specs/cancellation-compensation.md §3.4, §6.2).
 *
 * Self-contained like the iCal alerts: fetches its own list, renders nothing when there is none.
 * Each row offers « Encaisser » (the money landed), « Modifier » (the announced amount changed) and
 * ✕ (it will never be paid). Listens to `guestflow:compensations-changed` so declaring one from the
 * cancellation approval makes it appear without a reload.
 *
 * No business rule here: `overdue` and the amounts come ready-to-render from the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Button, IconButton, Tooltip, Divider, Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import PaymentsIcon from '@mui/icons-material/Payments';
import api from '../api';
import StatusBadge from './StatusBadge';
import CancellationCompensationDialog from './CancellationCompensationDialog';
import { useAppDialogs, useToast } from './DialogProvider';
import { displayDateShort, formatCurrency } from '../utils/formatters';

// The list endpoint is month-scoped for the received compensations only; the pending ones it
// returns are global, so any month works as the query parameter.
function currentMonthParams() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export default function CancellationCompensationsPendingAlert() {
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [pending, setPending] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode, compensation }

  const refresh = useCallback(async () => {
    try {
      const { month, year } = currentMonthParams();
      const payload = await api.getCancellationCompensations(month, year);
      setPending(Array.isArray(payload?.pending) ? payload.pending : []);
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('guestflow:compensations-changed', onChange);
    return () => window.removeEventListener('guestflow:compensations-changed', onChange);
  }, [refresh]);

  const handleSubmit = useCallback(async (payload) => {
    if (!dialog) return;
    const { mode, compensation } = dialog;
    setBusyId(compensation.id);
    try {
      if (mode === 'receive') {
        await api.receiveCancellationCompensation(compensation.id, payload);
        showSuccess('Indemnité encaissée — elle apparaît dans la comptabilité du mois du versement.');
      } else {
        await api.updateCancellationCompensation(compensation.id, { ...compensation, ...payload });
        showSuccess('Indemnité mise à jour.');
      }
      setDialog(null);
      await refresh();
    } catch (err) {
      showError(err.message || 'Enregistrement impossible.');
    } finally {
      setBusyId(null);
    }
  }, [dialog, refresh, showSuccess, showError]);

  const handleDelete = useCallback(async (compensation) => {
    const ok = await confirm({
      title: 'Supprimer cette indemnité ?',
      message: `L'indemnité de ${compensation.clientName || 'cette annulation'} ne sera plus attendue.`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    setBusyId(compensation.id);
    try {
      await api.deleteCancellationCompensation(compensation.id);
      await refresh();
    } catch (err) {
      showError(err.message || 'Suppression impossible.');
    } finally {
      setBusyId(null);
    }
  }, [confirm, refresh, showError]);

  if (pending.length === 0) return null;

  return (
    <>
      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }} icon={false}>
        <AlertTitle sx={{ fontWeight: 700 }}>
          Indemnités d&apos;annulation — {pending.length} versement{pending.length > 1 ? 's' : ''} en attente
        </AlertTitle>
        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mt: 1 }}>
          {pending.map((compensation) => (
            <Box key={compensation.id} sx={{ position: 'relative', pr: 5 }}>
              <Tooltip title="Supprimer cette indemnité">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(compensation)}
                    disabled={busyId === compensation.id}
                    sx={{ position: 'absolute', top: 0, right: 0 }}
                    aria-label="Supprimer cette indemnité"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {compensation.clientName || `Indemnité #${compensation.id}`}
                {compensation.propertyName ? ` · ${compensation.propertyName}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {compensation.startDate && compensation.endDate ? (
                  <>Séjour annulé du <strong>{displayDateShort(compensation.startDate)}</strong> au <strong>{displayDateShort(compensation.endDate)}</strong></>
                ) : 'Séjour annulé'}
                {compensation.platform ? <> · <strong>{compensation.platform}</strong></> : null}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  Attendu : <strong>{formatCurrency(compensation.expectedAmount)}</strong>
                  {compensation.expectedDate ? ` · prévu le ${displayDateShort(compensation.expectedDate)}` : ''}
                </Typography>
                <StatusBadge
                  status={compensation.overdue ? 'warning' : 'neutral'}
                  label={compensation.overdue ? 'En retard' : 'En attente'}
                />
              </Stack>
              <Box sx={{ mt: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<PaymentsIcon />}
                  onClick={() => setDialog({ mode: 'receive', compensation })}
                  disabled={busyId === compensation.id}
                >
                  Encaisser
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={() => setDialog({ mode: 'edit', compensation })}
                  disabled={busyId === compensation.id}
                >
                  Modifier
                </Button>
              </Box>
            </Box>
          ))}
        </Stack>
      </Alert>

      <CancellationCompensationDialog
        open={Boolean(dialog)}
        mode={dialog ? dialog.mode : 'edit'}
        busy={Boolean(dialog) && busyId === dialog.compensation.id}
        context={dialog ? dialog.compensation : {}}
        onClose={() => setDialog(null)}
        onSubmit={handleSubmit}
      />
    </>
  );
}
