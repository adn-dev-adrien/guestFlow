/**
 * SettingsQuoteSection — "Paramètres des devis" card.
 *
 * Props:
 *   values:    { footerText, footerTextEn, validityDays }
 *   errors:    { quoteValidityDays? }
 *   onChange:  (key, value) => void
 *   disabled:  boolean
 *
 * Bilingual devis PDF (specs/devis-english-language.md §3 rule 11 + §6.4) — two stacked
 * footer fields, FR above EN. Either can be left empty; the empty one falls back to a
 * static default in the matching language.
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
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">
              Paramètres des devis
            </Typography>
          </Box>

          <TextField
            label="Validité d'un devis (en jours)"
            type="number"
            value={v.validityDays ?? 30}
            onChange={(e) => onChange('validityDays', Number(e.target.value) || 30)}
            sx={{ maxWidth: 280 }}
            disabled={disabled}
            error={Boolean(errors.quoteValidityDays)}
            helperText={errors.quoteValidityDays || 'Combien de temps un nouveau devis reste valable. 30 par défaut.'}
            slotProps={{
              htmlInput: { min: 1, max: 365 }
            }}
          />

          <TextField
            label="Pied de page du devis (français)"
            value={v.footerText || ''}
            onChange={(e) => onChange('footerText', e.target.value)}
            fullWidth
            multiline
            minRows={4}
            disabled={disabled}
            helperText="Laissez vide pour utiliser le message par défaut (bienveillant et commercial)."
          />

          <TextField
            label="Pied de page du devis (anglais)"
            value={v.footerTextEn || ''}
            onChange={(e) => onChange('footerTextEn', e.target.value)}
            fullWidth
            multiline
            minRows={4}
            disabled={disabled}
            helperText="Utilisé sur les devis générés en anglais. Vide → message anglais par défaut."
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
