/**
 * ReservationCancelDialog — confirm a cancellation for non-payment
 * (specs/payment-schedule-and-cancellation.md §3.5 rule 22 / §6).
 *
 * Recaps what is being cancelled and, above all, what happens to the money: the acompte already
 * collected is kept as an indemnity, the unpaid solde is written off. Both figures come from the
 * server row — nothing is computed here.
 *
 * Composed from the shared FormDialog (fullScreen on mobile for free).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { displayDate, formatCurrency } from '../utils/formatters';

export default function ReservationCancelDialog({ open, row, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [notifyClient, setNotifyClient] = useState(true);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNotifyClient(Boolean(row && row.clientEmail));
  }, [open, row]);

  if (!row) return null;

  const retained = Number(row.retainedDepositAmount || 0);
  const writtenOff = Number(row.balanceDue || 0);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Annuler le séjour"
      submitLabel={busy ? 'Annulation…' : 'Annuler le séjour'}
      submitColor="error"
      submitDisabled={busy}
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

        <Box>
          <Typography variant="body2">
            Acompte conservé : <strong>{formatCurrency(retained)}</strong>
          </Typography>
          <Typography variant="body2">
            Solde abandonné : <strong>{formatCurrency(writtenOff)}</strong>
          </Typography>
        </Box>

        <Alert severity="warning" variant="outlined">
          Les dates seront remises à la vente.
          {retained > 0
            ? " L'acompte encaissé est requalifié en indemnité (hors TVA) dans la comptabilité du mois en cours."
            : ' Aucun acompte n’a été encaissé : rien n’est conservé.'}
        </Alert>

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
