/**
 * ReservationCancelDialog — confirm a cancellation for non-payment
 * (specs/payment-schedule-and-cancellation.md §3.5 rule 22 / §6).
 *
 * Recaps what is being cancelled and, above all, what happens to the money: what was collected is kept
 * as an indemnity, what is still owed is written off. Both figures are the cancellation's own, asked
 * from GET /reservations/:id/cancel-preview when the dialog opens (rule 60) — nothing is computed
 * here. While they load the confirm waits; a refusal is shown and the confirm stays off.
 *
 * Composed from the shared FormDialog (fullScreen on mobile for free).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, Skeleton, Stack, TextField, Typography } from '@mui/material';
import api from '../api';
import FormDialog from './FormDialog';
import { displayDate, formatCurrency } from '../utils/formatters';

export default function ReservationCancelDialog({ open, row, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [notifyClient, setNotifyClient] = useState(true);
  const [preview, setPreview] = useState({ status: 'loading', figures: null, error: '' });
  const reservationId = row ? row.reservationId : null;

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNotifyClient(Boolean(row && row.clientEmail));
  }, [open, row]);

  useEffect(() => {
    if (!open || !reservationId) return undefined;
    let current = true;
    setPreview({ status: 'loading', figures: null, error: '' });
    api.getCancellationPreview(reservationId)
      .then((figures) => { if (current) setPreview({ status: 'ready', figures, error: '' }); })
      .catch((err) => { if (current) setPreview({ status: 'refused', figures: null, error: err.message || 'Annulation impossible.' }); });
    return () => { current = false; };
  }, [open, reservationId]);

  if (!row) return null;

  const ready = preview.status === 'ready';
  const retained = ready ? Number(preview.figures.retainedDepositAmount || 0) : 0;
  const writtenOff = ready ? Number(preview.figures.writtenOffBalance || 0) : 0;
  const amount = (value) => (ready
    ? <strong>{formatCurrency(value)}</strong>
    : <Skeleton variant="text" width={72} sx={{ display: 'inline-block', verticalAlign: 'middle' }} />);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Annuler le séjour"
      submitLabel={busy ? 'Annulation…' : 'Annuler le séjour'}
      submitColor="error"
      submitDisabled={busy || !ready}
      cancelLabel="Revenir"
      onSubmit={() => onConfirm({ reason: reason.trim(), notifyClient })}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {row.clientName}
            {row.propertyName ? ` · ${row.propertyName}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Du {displayDate(row.startDate)} au {displayDate(row.endDate)}
            {row.reservationNumber ? ` · n° ${row.reservationNumber}` : ''}
          </Typography>
        </Box>

        {preview.status === 'refused' ? (
          <Alert severity="error" variant="outlined">{preview.error}</Alert>
        ) : (
          <>
            <Box aria-busy={!ready}>
              <Typography variant="body2">
                Conservé en indemnité : {amount(retained)}
              </Typography>
              <Typography variant="body2">
                Solde abandonné : {amount(writtenOff)}
              </Typography>
            </Box>

            <Alert severity="warning" variant="outlined">
              Les dates seront remises à la vente.
              {ready && (retained > 0
                ? ' Le montant conservé est requalifié en indemnité (hors TVA) dans la comptabilité du mois en cours.'
                : ' Rien n’est requalifié en indemnité.')}
            </Alert>
          </>
        )}

        <TextField
          label="Motif"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Solde jamais réglé, client injoignable…"
          fullWidth
          size="small"
          multiline
          minRows={2}
        />

        <FormControlLabel
          control={(
            <Checkbox
              checked={notifyClient}
              onChange={(e) => setNotifyClient(e.target.checked)}
              disabled={!row.clientEmail}
            />
          )}
          label={row.clientEmail
            ? 'Prévenir le client par email'
            : 'Prévenir le client par email (aucune adresse enregistrée)'}
        />
      </Stack>
    </FormDialog>
  );
}
