/**
 * SettingsQuoteSection — "Paramètres des devis" card.
 *
 * Props:
 *   values:    { footerText, validityDays }
 *   errors:    { quoteValidityDays? }
 *   onChange:  (key, value) => void
 *   disabled:  boolean
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField, Box } from '@mui/material';

export default function SettingsQuoteSection({
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
              Paramètres des devis
            </Typography>
          </Box>

          <TextField
            label="Validité d'un devis (en jours)"
            type="number"
            value={v.validityDays ?? 30}
            onChange={(e) => onChange('validityDays', Number(e.target.value) || 30)}
            inputProps={{ min: 1, max: 365 }}
            sx={{ maxWidth: 280 }}
            disabled={disabled}
            error={Boolean(errors.quoteValidityDays)}
            helperText={errors.quoteValidityDays || 'Combien de temps un nouveau devis reste valable. 30 par défaut.'}
          />

          <TextField
            label="Texte affiché en bas de chaque devis"
            value={v.footerText || ''}
            onChange={(e) => onChange('footerText', e.target.value)}
            fullWidth
            multiline
            minRows={4}
            disabled={disabled}
            helperText="Laissez vide pour utiliser le message par défaut (bienveillant et commercial)."
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
