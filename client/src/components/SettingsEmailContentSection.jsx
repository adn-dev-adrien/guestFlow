/**
 * SettingsEmailContentSection — « Contenu des mails » card of Paramètres → Emails & notifications.
 *
 * The settings the guest emails quote (specs/guest-email-sequence.md §6.2): the review link and the
 * social links of the J+1 email (specs/settings-input-guards.md §3.7). The pool season belongs to the property that has the pool (Logement ›
 * Séjour, specs/guest-email-texts-made-simple.md rule 34). Whether an email leaves by itself
 * is not decided here any more: each template has its own mode (specs/settings-rationalization.md
 * rule 17b).
 *
 * Props:
 *   values:   { googleReviewUrl, socialLinks, socialNetworks }
 *   onChange: (key, value) => void
 *   disabled: boolean
 *   errors:   { [column]: string } — server validation messages
 */
import React from 'react';
import { Link as RouterLink } from 'react-router';
import { Card, CardContent, Stack, Typography, Box, Button } from '@mui/material';
import HelpedTextField from './HelpedTextField';
import SocialLinksField from './SocialLinksField';

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
          <SocialLinksField
            links={values.socialLinks || []}
            networks={values.socialNetworks || []}
            onChange={(next) => onChange('socialLinks', next)}
            errors={errors}
            disabled={disabled}
          />
          {/* specs/plugins-phase-p-productisation.md §6 — the sentences of the emails. */}
          <Box>
            <Button component={RouterLink} to="/settings/emails/textes" variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Textes des emails
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
