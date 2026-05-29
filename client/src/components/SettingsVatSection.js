/**
 * SettingsVatSection — "Taux de TVA" card.
 *
 * Two global VAT rates, common to every property: accommodation (the nightly stay) and standard
 * (everything else billable — options, custom options, resources). Replaces the former per-property
 * VAT settings.
 *
 * Props:
 *   values:    { accommodationRate, standardRate }
 *   errors:    { vatRateAccommodation?, vatRateStandard? }
 *   onChange:  (key, value) => void   // key is 'accommodationRate' | 'standardRate'
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
              Communs à tous les logements. L'hébergement a son propre taux ; tout le reste (options,
              ressources) utilise le taux standard.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="TVA hébergement (%)"
              type="number"
              value={v.accommodationRate ?? 10}
              onChange={(e) => onChange('accommodationRate', e.target.value === '' ? '' : Number(e.target.value))}
              inputProps={{ min: 0, max: 100, step: 0.5 }}
              fullWidth
              disabled={disabled}
              error={Boolean(errors.vatRateAccommodation)}
              helperText={errors.vatRateAccommodation || '10 % par défaut.'}
            />
            <TextField
              label="TVA standard (%)"
              type="number"
              value={v.standardRate ?? 20}
              onChange={(e) => onChange('standardRate', e.target.value === '' ? '' : Number(e.target.value))}
              inputProps={{ min: 0, max: 100, step: 0.5 }}
              fullWidth
              disabled={disabled}
              error={Boolean(errors.vatRateStandard)}
              helperText={errors.vatRateStandard || '20 % par défaut (options, ressources).'}
            />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
