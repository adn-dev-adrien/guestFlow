/**
 * CancellationCompensationDialog — the single dialog through which a cancellation compensation is
 * declared, corrected or banked (specs/cancellation-compensation.md §6.1, §6.2).
 *
 * Four modes, one component, because they ask for the same things in different orders:
 *   - `ask`     — shown when the operator approves an iCal cancellation: « indemnité attendue ? »
 *                 with « Aucune indemnité » preselected (the common case is one click + Valider).
 *   - `edit`    — change an announced amount / date / note while the compensation is still pending.
 *   - `receive` — the money landed: real amount + real date, which freeze the row.
 *   - `create`  — a compensation with no iCal alert behind it: the stay it replaces has to be typed
 *                 in by hand (there is no reservation left to snapshot).
 *
 * Renders no business rule of its own: amounts and dates are validated server-side, and the parent
 * owns the API call. `onSubmit(payload)` receives `null` in `ask` mode when no compensation is due.
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, RadioGroup, Radio, FormControlLabel, TextField, Alert,
} from '@mui/material';
import FormDialog from './FormDialog';
import ArithmeticTextField from './ArithmeticTextField';
import DateField from './DateField';
import { displayDateShort, formatCurrency } from '../utils/formatters';

const TITLES = {
  ask: 'Annulation — indemnité attendue ?',
  edit: "Modifier l'indemnité d'annulation",
  receive: "Encaisser l'indemnité",
  create: "Ajouter une indemnité d'annulation",
};

const SUBMIT_LABELS = { ask: 'Valider', edit: 'Enregistrer', receive: 'Encaisser', create: 'Ajouter' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function CancellationCompensationDialog({
  open,
  mode = 'ask',
  // { clientName, propertyName, platform, startDate, endDate, cancelledStayAmount, expectedAmount,
  //   expectedDate, notes } — whatever is known; every field is optional.
  context = {},
  busy = false,
  error = '',
  onClose,
  onSubmit,
}) {
  const [expectsCompensation, setExpectsCompensation] = useState(false);
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  // `create` only — the cancelled stay has to be described by hand.
  const [stay, setStay] = useState({ propertyName: '', platform: '', clientFirstName: '', clientLastName: '', startDate: '', endDate: '' });

  // Reset on every open so a previous dialog's draft never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setExpectsCompensation(mode !== 'ask');
    setExpectedAmount(context.expectedAmount ?? '');
    setExpectedDate(context.expectedDate || '');
    setNotes(context.notes || '');
    setReceivedAmount(context.expectedAmount ?? '');
    setReceivedDate(todayIso());
    setStay({
      propertyName: context.propertyName || '',
      platform: context.platform || '',
      clientFirstName: context.clientFirstName || '',
      clientLastName: context.clientLastName || '',
      startDate: context.startDate || '',
      endDate: context.endDate || '',
    });
  }, [open, mode, context.expectedAmount, context.expectedDate, context.notes,
      context.propertyName, context.platform, context.clientFirstName, context.clientLastName,
      context.startDate, context.endDate]);

  const stayLine = [
    context.startDate && context.endDate
      ? `Du ${displayDateShort(context.startDate)} au ${displayDateShort(context.endDate)}`
      : '',
    context.platform || '',
  ].filter(Boolean).join(' · ');

  const handleSubmit = () => {
    if (mode === 'receive') {
      onSubmit({ receivedAmount, receivedDate });
      return;
    }
    if (mode === 'ask' && !expectsCompensation) {
      onSubmit(null);
      return;
    }
    const draft = { expectedAmount: expectedAmount === '' ? 0 : expectedAmount, expectedDate: expectedDate || null, notes };
    onSubmit(mode === 'create' ? { ...stay, ...draft } : draft);
  };

  const setStayField = (field) => (e) => setStay((prev) => ({ ...prev, [field]: e.target.value }));

  const submitDisabled = busy
    || (mode === 'receive' && (receivedAmount === '' || Number(receivedAmount) <= 0 || !receivedDate))
    || (mode === 'create' && !stay.platform.trim());

  return (
    <FormDialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={TITLES[mode] || TITLES.ask}
      submitLabel={SUBMIT_LABELS[mode] || 'Valider'}
      submitDisabled={submitDisabled}
      onSubmit={handleSubmit}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {mode !== 'create' && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {context.clientName || 'Réservation annulée'}
            {context.propertyName ? ` · ${context.propertyName}` : ''}
          </Typography>
          {stayLine && (
            <Typography variant="body2" color="text.secondary">{stayLine}</Typography>
          )}
          {context.cancelledStayAmount != null && (
            <Typography variant="body2" color="text.secondary">
              Séjour annulé : <strong>{formatCurrency(context.cancelledStayAmount)}</strong>
            </Typography>
          )}
        </Box>
        )}

        {mode === 'create' && (
          <>
            <TextField
              label="Plateforme"
              value={stay.platform}
              onChange={setStayField('platform')}
              fullWidth
              required
              autoFocus
              helperText="Qui verse l'indemnité (Airbnb, Booking, Gîtes de France…)."
            />
            <TextField label="Logement" value={stay.propertyName} onChange={setStayField('propertyName')} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Prénom du client" value={stay.clientFirstName} onChange={setStayField('clientFirstName')} fullWidth />
              <TextField label="Nom du client" value={stay.clientLastName} onChange={setStayField('clientLastName')} fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DateField
                label="Arrivée prévue"
                value={stay.startDate}
                onChange={setStayField('startDate')}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <DateField
                label="Départ prévu"
                value={stay.endDate}
                onChange={setStayField('endDate')}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          </>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {mode === 'ask' && (
          <RadioGroup
            value={expectsCompensation ? 'yes' : 'no'}
            onChange={(e) => setExpectsCompensation(e.target.value === 'yes')}
          >
            <FormControlLabel value="no" control={<Radio />} label="Aucune indemnité" />
            <FormControlLabel value="yes" control={<Radio />} label="Indemnité attendue de la plateforme" />
          </RadioGroup>
        )}

        {mode === 'receive' ? (
          <>
            <ArithmeticTextField
              label="Montant versé (€)"
              value={receivedAmount}
              onCommit={setReceivedAmount}
              fullWidth
              autoFocus
              helperText="Ce que la plateforme a réellement viré."
            />
            <DateField
              label="Date du versement"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Date à laquelle l'argent est arrivé — c'est la date comptable de l'écriture."
            />
          </>
        ) : (
          (mode !== 'ask' || expectsCompensation) && (
            <>
              <ArithmeticTextField
                label="Montant attendu (€)"
                value={expectedAmount}
                onCommit={setExpectedAmount}
                fullWidth
                helperText="Modifiable jusqu'au versement. Laissez 0 si la plateforme ne l'a pas encore annoncé."
              />
              <DateField
                label="Versement prévu le"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Facultatif. Sert à signaler un versement en retard."
              />
              <TextField
                label="Note"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
            </>
          )
        )}

        {mode === 'ask' && (
          <Typography variant="caption" color="text.secondary">
            La réservation sera supprimée dans tous les cas.
          </Typography>
        )}
      </Stack>
    </FormDialog>
  );
}
