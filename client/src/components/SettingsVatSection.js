/**
 * SettingsVatSection — "Taux de TVA" card.
 *
 * Two global VAT rates:
 *   - `rate` (default 10) — uniform rate applied to every revenue stream (accommodation,
 *     options, resources, custom options). Single-rate model per specs/single-vat-rate.md §6.1.
 *   - `rateCommission` (default 20) — VAT rate applied to platform commissions whose row on
 *     `/comptabilite/plateformes` carries `hasVatOnCommission = 1`. Spec:
 *     accounting-platform-commission-and-no-deposit.md §3.7 rule 17b.
 *
 * Props:
 *   values:    { rate, rateCommission }
 *   errors:    { vatRate?, vatRateCommission? }
 *   onChange:  (key, value) => void   // key is 'rate' or 'rateCommission'
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
            fullWidth
            disabled={disabled}
            error={Boolean(errors.vatRate)}
            helperText={errors.vatRate || '10 % par défaut.'}
            sx={{ maxWidth: { sm: 320 } }}
            slotProps={{
              htmlInput: { min: 0, max: 100, step: 0.5 }
            }}
          />

          <TextField
            label="TVA déductible commissions (%)"
            type="number"
            value={v.rateCommission ?? 20}
            onChange={(e) => onChange('rateCommission', e.target.value === '' ? '' : Number(e.target.value))}
            fullWidth
            disabled={disabled}
            error={Boolean(errors.vatRateCommission)}
            helperText={errors.vatRateCommission || "Taux appliqué aux commissions plateforme marquées 'TVA déductible' dans le Plan comptable plateformes."}
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
