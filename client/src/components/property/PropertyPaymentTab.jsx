/**
 * PropertyPaymentTab — « Paiement & caution » tab of the property page
 * (specs/settings-rationalization.md rule 21, specs/property-deposit-switch.md §6): the « Demander
 * un acompte » switch (its % and due days shown only when on), the balance / single payment due
 * date, the cancellation delay and the default deposit.
 *
 * The four numbers are bounded fields fed by the server's limits (specs/settings-input-guards.md
 * rules 9-14): a refusal shows under the field, in red.
 *
 * Props: form, errors, updateField(field, value), onZeroFocus(event), limits (the server's
 * descriptors, by field)
 */
import React from 'react';
import BoundedNumberField from '../BoundedNumberField';
import { Box, Card, CardContent, FormControlLabel, Switch, TextField, Typography } from '@mui/material';

export default function PropertyPaymentTab({ form, errors = {}, updateField, onZeroFocus, limits = {} }) {
  const bounded = (field, label, helperText) => (
    <BoundedNumberField
      label={label}
      value={form[field] ?? ''}
      onCommit={(next) => updateField(field, next)}
      limits={limits[field]}
      error={errors[field]}
      helperText={helperText}
      fullWidth
      size="small"
    />
  );
  const number = (field, label, helperText, inputProps) => (
    <TextField
      label={label}
      type="number"
      value={form[field] ?? ''}
      onChange={(e) => updateField(field, e.target.value)}
      onFocus={onZeroFocus}
      fullWidth
      size="small"
      error={Boolean(errors[field])}
      helperText={errors[field] || helperText}
      slotProps={inputProps ? { htmlInput: inputProps } : undefined}
    />
  );
  const deposit = Boolean(form.depositEnabled);

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>Acompte</Typography>
          <FormControlLabel
            control={<Switch checked={deposit} onChange={(e) => updateField('depositEnabled', e.target.checked)} />}
            label="Demander un acompte"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5, ml: 0.5 }}>
            {deposit
              ? "Le séjour est payé en deux fois : un acompte à la réservation, le solde avant l'arrivée."
              : 'Le séjour est payé en une fois, à la réservation.'}
          </Typography>
          {deposit && (
            <Box sx={{ display: 'flex', gap: 2, mt: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              {bounded('depositPercent', '% acompte', '')}
              {/* specs/payment-schedule-and-cancellation.md §3.1 — due from the BOOKING, not the arrival. */}
              {bounded('depositDueDays', 'Acompte (jours après réservation)', '0 : à régler à la réservation.')}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="sectionHeader" gutterBottom sx={{ display: 'block' }}>
            {deposit ? 'Solde & caution' : 'Paiement & caution'}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {bounded('balanceDaysBefore', deposit ? 'Solde (jours avant l\'arrivée)' : 'Paiement (jours avant l\'arrivée)',
              "Échéance du solde — ou du paiement unique quand l'acompte est désactivé.")}
            {bounded('cancelAfterBalanceDueDays', 'Annulation (jours après échéance du solde)',
              // specs/property-deposit-switch.md rule 14 — no acompte, nothing to keep.
              deposit
                ? "Délai avant de pouvoir annuler un séjour dont le solde n'est pas réglé. L'acompte encaissé est alors conservé à titre d'indemnité."
                : "Délai avant de pouvoir annuler un séjour dont le paiement n'est pas réglé. Sans acompte, l'annulation suit les conditions des CGV.")}
            {/* specs/guest-email-texts-made-simple.md rule 28 — empty: not sent, the stored amount stays (2026-10-18). */}
            {number('defaultCautionAmount', 'Caution par défaut (€)', form.defaultCautionAmount === '' ? 'Vide : rien n’est changé. 0 : pas de caution.' : '0 : pas de caution.', { step: 50, min: 0 })}
          </Box>
        </CardContent>
      </Card>
    </>
  );
}
