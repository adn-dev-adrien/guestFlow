/**
 * SettingsVatSection — « TVA des séjours » card of Paramètres → TVA & exercice.
 *
 * One rate, applied to every revenue stream (accommodation, options, resources, custom options —
 * specs/single-vat-rate.md §6.1). The commission and cancellation-indemnity rates are edited on
 * Plan comptable, next to the accounts that use them (specs/settings-rationalization.md rule 14).
 *
 * Props:
 *   values:    { rate }
 *   errors:    { vatRate? }
 *   onChange:  (key, value) => void   // 'rate'
 *   disabled:  boolean
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField, Box } from '@mui/material';

export default function SettingsVatSection({
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
          <Box>
            <Typography variant="sectionHeader">
              TVA des séjours
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Appliqué à l'ensemble des prestations : hébergement, options, ressources.
            </Typography>
          </Box>

          <TextField
            label="Taux de TVA (%)"
            type="number"
            value={v.rate ?? 10}
            onChange={(e) => onChange('rate', e.target.value === '' ? '' : Number(e.target.value))}
            fullWidth
            disabled={disabled}
            error={Boolean(errors.vatRate)}
            helperText={errors.vatRate || '10 % par défaut.'}
            sx={{ maxWidth: { sm: 320 } }}
            slotProps={{
              htmlInput: { min: 0, max: 100, step: 0.5 }
            }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
