/**
 * PaymentDeadlinesAlert — Dashboard card for missed payment deadlines
 * (specs/payment-schedule-and-cancellation.md §3.4 / §6).
 *
 * Self-contained like the iCal alerts: fetches its own rows, renders nothing when there are none.
 * Each row offers « Envoyer la demande » / « Relancer » (mint the payment link and send the request —
 * the label depends on whether the guest was already asked), « Reporter » (hide it for a week without
 * moving any échéance) and, once the cancellation deadline is passed, « Annuler le séjour ». Since the
 * 2026-08-20 amendment no cron sends a money email, so this card is the ONLY thing that makes one
 * leave: a row left unattended is a guest who was never asked. A late PLATFORM payout (specs/platform-payout-due-date.md) offers « Reporter » alone:
 * the money is owed by the platform, so there is no guest to chase and no stay left to cancel — and a
 * platform booking whose amount was never entered carries no figure to print at all, only the row's
 * link to the fiche where the operator types it.
 *
 * No business rule here: the state, the amounts, the days late, whether cancelling is offered — all
 * of it arrives ready to render from the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Divider, Stack, Typography } from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import SendIcon from '@mui/icons-material/Send';
import SnoozeIcon from '@mui/icons-material/Snooze';
import api from '../api';
import StatusBadge from './StatusBadge';
import ReservationCancelDialog from './ReservationCancelDialog';
import { useToast } from './DialogProvider';
import { displayDateShort, formatCurrency } from '../utils/formatters';
import { DEADLINE_STATE_LABELS, DEADLINE_STATE_BADGE, deadlineHeadline } from '../constants/paymentDeadlines';

export default function PaymentDeadlinesAlert() {
  const { showSuccess, showError } = useToast();
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [cancelRow, setCancelRow] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getPaymentDeadlines();
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRemind = useCallback(async (row) => {
    setBusyId(row.reservationId);
    try {
      await api.remindPaymentDeadline(row.reservationId, row.remindType);
      const noun = row.remindType === 'deposit' ? "Demande d'acompte" : 'Demande de solde';
      showSuccess(row.requestSent ? `${noun} renvoyée.` : `${noun} envoyée.`);
    } catch (err) {
      showError(err.message || "Envoi impossible.");
    } finally {
      setBusyId(null);
    }
  }, [showSuccess, showError]);

  const handleSnooze = useCallback(async (row) => {
    setBusyId(row.reservationId);
    try {
      await api.snoozePaymentDeadline(row.reservationId, 7);
      showSuccess("Rappel reporté d'une semaine — l'échéance, elle, n'a pas bougé.");
      await refresh();
    } catch (err) {
      showError(err.message || 'Report impossible.');
    } finally {
      setBusyId(null);
    }
  }, [refresh, showSuccess, showError]);

  const handleCancel = useCallback(async ({ reason, notifyClient }) => {
    if (!cancelRow) return;
    setBusyId(cancelRow.reservationId);
    try {
      const result = await api.cancelReservation(cancelRow.reservationId, { reason, notifyClient });
      showSuccess(result?.retainedDepositAmount > 0
        ? `Séjour annulé — acompte de ${formatCurrency(result.retainedDepositAmount)} conservé en indemnité.`
        : 'Séjour annulé — les dates sont remises à la vente.');
      setCancelRow(null);
      await refresh();
      window.dispatchEvent(new Event('guestflow:compensations-changed'));
    } catch (err) {
      showError(err.message || "Annulation impossible.");
    } finally {
      setBusyId(null);
    }
  }, [cancelRow, refresh, showSuccess, showError]);

  if (rows.length === 0) return null;

  // The worst of the rows: a card holding only « à demander » to-dos must not shout like one holding
  // a stay about to be cancelled.
  const severity = ['error', 'warning', 'info'].find((level) => rows.some((row) => row.severity === level))
    || 'warning';
  const lateCount = rows.filter((row) => !String(row.state).endsWith('_to_request')).length;
  const toRequestCount = rows.length - lateCount;

  return (
    <>
      <Alert severity={severity} variant="outlined" sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }} icon={false}>
        <AlertTitle sx={{ fontWeight: 700 }}>
          Échéances de paiement — {[
            lateCount > 0 ? `${lateCount} en retard` : null,
            toRequestCount > 0 ? `${toRequestCount} à demander` : null,
          ].filter(Boolean).join(' · ')}
        </AlertTitle>
        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mt: 1 }}>
          {rows.map((row) => (
            <Box key={row.reservationId}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={DEADLINE_STATE_BADGE[row.state]} label={DEADLINE_STATE_LABELS[row.state]} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {row.clientName}
                  {row.propertyName ? ` · ${row.propertyName}` : ''}
                  {row.platformLabel ? ` · ${row.platformLabel}` : ''}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Du {displayDateShort(row.startDate)} au {displayDateShort(row.endDate)}
                {row.reservationNumber ? ` · n° ${row.reservationNumber}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {deadlineHeadline(row)}
                {row.dueDate ? ` · échéance ${displayDateShort(row.dueDate)}` : ''}
              </Typography>
              {row.balanceDue > 0 || row.depositDue > 0 ? (
                <Typography variant="body2">
                  {row.balanceDue > 0 ? <>Solde <strong>{formatCurrency(row.balanceDue)}</strong></> : null}
                  {row.balanceDue > 0 && row.depositDue > 0 ? ' · ' : ''}
                  {row.depositDue > 0 ? <>Acompte <strong>{formatCurrency(row.depositDue)}</strong></> : null}
                  {row.canCancel && row.retainedDepositAmount > 0
                    ? <> · acompte conservé si annulation : <strong>{formatCurrency(row.retainedDepositAmount)}</strong></>
                    : null}
                </Typography>
              ) : null}
              <Box sx={{ mt: 1, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
                {row.remindType ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SendIcon />}
                    onClick={() => handleRemind(row)}
                    disabled={busyId === row.reservationId || !row.canRemind}
                  >
                    {row.requestSent ? 'Relancer' : 'Envoyer la demande'}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SnoozeIcon />}
                  onClick={() => handleSnooze(row)}
                  disabled={busyId === row.reservationId}
                >
                  Reporter
                </Button>
                {row.canCancel ? (
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    startIcon={<EventBusyIcon />}
                    onClick={() => setCancelRow(row)}
                    disabled={busyId === row.reservationId}
                  >
                    Annuler le séjour
                  </Button>
                ) : null}
              </Box>
            </Box>
          ))}
        </Stack>
      </Alert>

      <ReservationCancelDialog
        open={Boolean(cancelRow)}
        row={cancelRow}
        busy={Boolean(cancelRow) && busyId === cancelRow.reservationId}
        onClose={() => setCancelRow(null)}
        onConfirm={handleCancel}
      />
    </>
  );
}
