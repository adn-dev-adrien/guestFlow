/**
 * OnboardingEmailsStep — step « Vos emails » of the start assistant (specs/guest-email-texts-made-simple.md
 * rule 21): phone, sender name, the property's article as a choice, its address, way in and Wi-Fi,
 * then the J-2 of a sample stay rendered by the server with what is typed. Every field can be left
 * empty. Specific to the assistant.
 *
 * Props:
 *   emails     the server's `emails` block of GET /api/onboarding
 *   value      { phone, senderName, nameArticle, address, access, wifiName, wifiPassword }
 *   onChange   (patch) => void
 *   errors     { [field]: message }
 */
import React, { useEffect, useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import api from '../api';
import EmailPreviewPane from './EmailPreviewPane';

const PREVIEW_DELAY_MS = 400;

export default function OnboardingEmailsStep({ emails, value, onChange, errors = {} }) {
  const [preview, setPreview] = useState({ subject: '', body: '', loading: true, error: '' });
  const property = emails.property;

  useEffect(() => {
    const draft = { settings: { companyPhone: value.phone, smtpFromName: value.senderName } };
    if (property) {
      draft.arrival = { [property.id]: { address: value.address, accessFr: value.access, wifiName: value.wifiName, ...(value.wifiPassword ? { wifiPassword: value.wifiPassword } : {}) } };
      draft.properties = { [property.id]: { nameArticle: value.nameArticle } };
    }
    const timer = setTimeout(() => {
      api.previewEmailDraft({ stableKey: emails.previewStableKey, reservationId: 'sample', propertyId: property && property.id, draft })
        .then((r) => setPreview({ subject: r.subject, body: r.body, loading: false, error: '' }))
        .catch((err) => setPreview({ subject: '', body: '', loading: false, error: err.message || 'Aperçu impossible.' }));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, emails.previewStableKey, property]);

  const field = (key, label, extra = {}) => (
    <TextField
      label={label}
      value={value[key] || ''}
      onChange={(e) => onChange({ [key]: e.target.value })}
      error={Boolean(errors[key])}
      helperText={errors[key] || ' '}
      fullWidth
      {...extra}
    />
  );

  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
        {field('phone', 'Téléphone')}
        {field('senderName', 'Nom d’expéditeur')}
      </Box>
      {property && (
        <>
          <Typography variant="body2" color="text.secondary">Article du logement</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', pb: 1 }} role="radiogroup" aria-label="Article du logement">
            {emails.articles.map((a) => (
              <Chip
                key={a.value}
                label={a.label}
                role="radio"
                aria-checked={value.nameArticle === a.value}
                color={value.nameArticle === a.value ? 'primary' : 'default'}
                variant={value.nameArticle === a.value ? 'filled' : 'outlined'}
                onClick={() => onChange({ nameArticle: a.value })}
                sx={{ minHeight: 40 }}
              />
            ))}
          </Stack>
          {errors.nameArticle && <Typography variant="caption" color="error">{errors.nameArticle}</Typography>}
          {field('address', 'Adresse')}
          {field('access', 'Accès', { multiline: true, minRows: 2 })}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
            {field('wifiName', 'Wi-Fi')}
            {field('wifiPassword', 'Mot de passe Wi-Fi', { type: 'password', placeholder: property.hasWifiPassword ? '••••••' : '' })}
          </Box>
        </>
      )}
      <Typography variant="body2" color="text.secondary">Aperçu — J-2 · Exemple</Typography>
      <EmailPreviewPane subject={preview.subject} body={preview.body} loading={preview.loading} error={preview.error} />
    </Stack>
  );
}
