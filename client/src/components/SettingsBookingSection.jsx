/**
 * SettingsBookingSection — « Réservation en ligne » card of Paramètres → Établissement.
 *
 * Props:
 *   values:    { horizonMonths }
 *   errors:    { bookingHorizonMonths? }
 *   onChange:  (key, value) => void
 *   disabled:  boolean
 *
 * How far ahead the public may book a lodging, in whole months (specs/gift-voucher-campaigns.md rule 51).
 * The date limit itself is computed by the server; this field only edits the number of months.
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField } from '@mui/material';

export default function SettingsBookingSection({
  values,
  errors = {},
  onChange,
  disabled = false,
}) {
  const v = values || {};
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="sectionHeader">
            Réservation en ligne
          </Typography>
          <TextField
            label="Horizon de réservation en ligne (mois)"
            type="number"
            value={v.horizonMonths ?? 12}
            onChange={(e) => onChange('horizonMonths', e.target.value === '' ? '' : Number(e.target.value))}
            sx={{ maxWidth: 280 }}
            disabled={disabled}
            error={Boolean(errors.bookingHorizonMonths)}
            helperText={errors.bookingHorizonMonths || 'Jusqu’où le public peut réserver un logement, à partir d’aujourd’hui. 12 par défaut.'}
            slotProps={{ htmlInput: { min: 1, max: 36, step: 1 } }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
