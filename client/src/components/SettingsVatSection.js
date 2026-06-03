/**
 * SettingsVatSection — "Taux de TVA" card.
 *
 * One global VAT rate applied uniformly to every revenue stream — accommodation, options,
 * resources, custom options (specs/single-vat-rate.md §6.1). The previous 2-rate model
 * (accommodation vs standard) was collapsed since every line on a GuestFlow installation is
 * invoiced under the same reduced rate.
 *
 * Props:
 *   values:    { rate }
 *   errors:    { vatRate? }
 *   onChange:  (key, value) => void   // key is 'rate'
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
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Taux de TVA
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
            inputProps={{ min: 0, max: 100, step: 0.5 }}
            fullWidth
            disabled={disabled}
            error={Boolean(errors.vatRate)}
            helperText={errors.vatRate || '10 % par défaut.'}
            sx={{ maxWidth: { sm: 320 } }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
