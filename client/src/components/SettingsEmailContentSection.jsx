/**
 * SettingsEmailContentSection — « Contenu des mails » card of Paramètres → Emails & notifications.
 *
 * The settings the guest emails quote (specs/guest-email-sequence.md §6.2): the review and Instagram
 * links of the J+1 email, and the pool season the emails mention. Whether an email leaves by itself
 * is not decided here any more: each template has its own mode (specs/settings-rationalization.md
 * rule 17b).
 *
 * Props:
 *   values:   { googleReviewUrl, instagramUrl, poolSeasonStart, poolSeasonEnd }
 *   onChange: (key, value) => void
 *   disabled: boolean
 *   errors:   { [column]: string } — server validation messages
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, Box, TextField } from '@mui/material';
import HelpedTextField from './HelpedTextField';

export default function SettingsEmailContentSection({
  values = {},
  onChange,
  disabled = false,
  errors = {},
}) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Contenu des mails</Typography>
            <Typography variant="body2" color="text.secondary">
              Repris dans les mails envoyés aux clients.
            </Typography>
          </Box>

          <HelpedTextField
            label="Lien d'avis Google"
            value={values.googleReviewUrl || ''}
            onChange={(v) => onChange('googleReviewUrl', v)}
            helperText="Proposé dans le mail de remerciement (J+1)."
            error={errors.googleReviewUrl}
            disabled={disabled}
          />
          <HelpedTextField
            label="Lien Instagram"
            value={values.instagramUrl || ''}
            onChange={(v) => onChange('instagramUrl', v)}
            helperText="« Si vous êtes nostalgiques de votre séjour… » dans le mail J+1."
            error={errors.instagramUrl}
            disabled={disabled}
          />
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              label="Piscine ouverte du (MM-JJ)"
              value={values.poolSeasonStart || ''}
              onChange={(e) => onChange('poolSeasonStart', e.target.value)}
              error={Boolean(errors.poolSeasonStart)}
              helperText={errors.poolSeasonStart || 'ex. 06-15'}
              disabled={disabled}
              fullWidth
            />
            <TextField
              label="au (MM-JJ)"
              value={values.poolSeasonEnd || ''}
              onChange={(e) => onChange('poolSeasonEnd', e.target.value)}
              error={Boolean(errors.poolSeasonEnd)}
              helperText={errors.poolSeasonEnd || 'ex. 08-31'}
              disabled={disabled}
              fullWidth
            />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
