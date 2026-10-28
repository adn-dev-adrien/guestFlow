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
 * Without online payment (specs/plugins-phase-3a-online-payment.md rule 25) the server marks the row
 * `remindByEmail` with the template to use: « Envoyer la demande » then opens that email in the send
 * dialog, for the operator to read before it leaves.
 *
 * When the online-payment plugin reads the bank account (specs/reconciliation-assisted-matching.md rule 22),
 * an overdue row may carry a `bank` line — « Virement trouvé : … » with « Confirmer », or « Rien sur le
 * compte »; the card draws it and nothing otherwise.
 *
 * No business rule here: the state, the amounts, the days late, whether cancelling is offered — all
 * of it arrives ready to render from the server; the card's title, count, « N en retard · M à
 * demander » and severity come with `attention` (specs/shell-and-home-day-first.md rules 3, 6).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import SendIcon from '@mui/icons-material/Send';
import SnoozeIcon from '@mui/icons-material/Snooze';
import { Link as RouterLink, useInRouterContext } from 'react-router';
import api from '../api';
import AttentionCard from './AttentionCard';
import StatusBadge from './StatusBadge';
import ReservationCancelDialog from './ReservationCancelDialog';
import EmailManualSendDialog from './EmailManualSendDialog';
import { useToast } from './DialogProvider';
import { displayDateShort, formatCurrency } from '../utils/formatters';
import { DEADLINE_STATE_LABELS, DEADLINE_STATE_BADGE, deadlineHeadline } from '../constants/paymentDeadlines';

export default function PaymentDeadlinesAlert({ attention }) {
  const { showSuccess, showError } = useToast();
  const inRouter = useInRouterContext();
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [cancelRow, setCancelRow] = useState(null);
  const [draftRow, setDraftRow] = useState(null);

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
    if (row.remindByEmail) {
      setDraftRow(row);
      return;
    }
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

  const handleBankConfirm = useCallback(async (row) => {
    setBusyId(row.reservationId);
    try {
      const { proposalId, amountCents } = row.bank;
      const answer = await api.confirmAllReconciliation({ proposalIds: [proposalId], amounts: { [proposalId]: amountCents } });
      if (answer.skipped.length > 0) showError(answer.skipped[0].message);
      else showSuccess('Rapproché. La fiche est marquée reçue.');
      await refresh();
    } catch (err) {
      showError(err.message || 'Rapprochement impossible.');
    } finally {
      setBusyId(null);
    }
  }, [refresh, showSuccess, showError]);

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
      // specs/plugins-phase-3a-online-payment.md rule 9 — a link the provider still accepts outranks the
      // success: one toast at a time, so the warning carries the cancellation, and the deposit kept.
      const done = result?.retainedDepositAmount > 0
        ? `Séjour annulé — acompte de ${formatCurrency(result.retainedDepositAmount)} conservé en indemnité.`
        : 'Séjour annulé — les dates sont remises à la vente.';
      // specs/email-language-fr-en.md rule 12 — a notice asked for and not sent is a warning too.
      const warnings = [result?.paymentLinksWarning, result?.emailWarning].filter(Boolean);
      if (warnings.length) showError([done, ...warnings].join(' '));
      else showSuccess(done);
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

  return (
    <>
      <AttentionCard attention={attention}>
        <Stack divider={<Divider flexItem />} spacing={1.5}>
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
              {row.bank ? (
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" color={row.bank.state === 'proposed' ? 'success.main' : 'text.secondary'}>
                    {row.bank.label}{row.bank.confidenceLabel ? ` · ${row.bank.confidenceLabel}` : ''}
                  </Typography>
                  {row.bank.proposalId ? (
                    <Button
                      size="small" variant="text" onClick={() => handleBankConfirm(row)} disabled={busyId === row.reservationId} sx={{ minHeight: 44 }}
                      aria-label={`Confirmer le virement de ${formatCurrency(row.bank.amountCents / 100)} pour ${row.clientName}`}
                    >
                      Confirmer
                    </Button>
                  ) : null}
                  {row.bank.state === 'proposed' && !row.bank.proposalId ? (
                    <Button
                      size="small" variant="text" sx={{ minHeight: 44 }} {...(inRouter ? { component: RouterLink, to: `/reservations/${row.reservationId}` } : { href: `/reservations/${row.reservationId}` })}
                      aria-label={`Vérifier le virement pour ${row.clientName}`}
                    >
                      Vérifier
                    </Button>
                  ) : null}
                </Stack>
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
                {row.remindByEmail && row.remindNote ? (
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: { sm: 'center' } }}>
                    {row.remindNote}
                  </Typography>
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
      </AttentionCard>

      {draftRow ? (
        <EmailManualSendDialog
          key={draftRow.reservationId}
          open
          reservationId={draftRow.reservationId}
          defaultTemplateId={draftRow.remindTemplateId}
          onClose={() => setDraftRow(null)}
          onSent={() => {
            showSuccess(draftRow.remindType === 'deposit' ? "Demande d'acompte envoyée." : 'Demande de solde envoyée.');
            refresh();
          }}
        />
      ) : null}

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
