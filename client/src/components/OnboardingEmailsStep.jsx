/**
 * OnboardingEmailsStep — step « Vos emails » of the start assistant (specs/guest-email-texts-made-simple.md
 * rule 21): phone and sender name, then for every property its article as a choice, its address (the
 * company's offered by the server), way in and Wi-Fi; then the J-2 of a sample stay rendered by the
 * server with what is typed. Every field can be left empty. Specific to the assistant.
 *
 * Props:
 *   emails     the server's `emails` block of GET /api/onboarding
 *   value      { phone, senderName, properties: { [id]: { nameArticle, address, access, wifiName, wifiPassword } } }
 *   onChange   (patch) => void — `{ phone }`, or `{ property: id, patch }`
 *   errors     { [field]: message }
 */
import React, { useEffect, useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import api from '../api';
import EmailPreviewPane from './EmailPreviewPane';

const PREVIEW_DELAY_MS = 400;

export default function OnboardingEmailsStep({ emails, value, onChange, errors = {} }) {
  const [preview, setPreview] = useState({ subject: '', body: '', loading: true, error: '' });
  const first = emails.properties[0];

  useEffect(() => {
    const draft = { settings: { companyPhone: value.phone, smtpFromName: value.senderName }, arrival: {}, properties: {} };
    for (const [id, p] of Object.entries(value.properties || {})) {
      draft.arrival[id] = { address: p.address, accessFr: p.access, wifiName: p.wifiName, ...(p.wifiPassword ? { wifiPassword: p.wifiPassword } : {}) };
      draft.properties[id] = { nameArticle: p.nameArticle };
    }
    const timer = setTimeout(() => {
      api.previewEmailDraft({ stableKey: emails.previewStableKey, reservationId: 'sample', propertyId: first && first.id, draft })
        .then((r) => setPreview({ subject: r.subject, body: r.body, loading: false, error: '' }))
        .catch((err) => setPreview({ subject: '', body: '', loading: false, error: err.message || 'Aperçu impossible.' }));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, emails.previewStableKey, first]);

  const text = (label, current, onText, error, extra = {}) => (
    <TextField label={label} value={current || ''} onChange={(e) => onText(e.target.value)} error={Boolean(error)} helperText={error || ' '} fullWidth {...extra} />
  );

  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
        {text('Téléphone', value.phone, (v) => onChange({ phone: v }), errors.phone)}
        {text('Nom d’expéditeur', value.senderName, (v) => onChange({ senderName: v }), errors.senderName)}
      </Box>
      {emails.properties.map((property, i) => {
        const p = (value.properties || {})[property.id] || {};
        const set = (patch) => onChange({ property: property.id, patch });
        const err = (key) => errors[`properties.${i}.${key}`];
        return (
          <Box key={property.id} component="section" aria-label={property.name} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{property.name}</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', pb: 1.5 }} role="radiogroup" aria-label={`Article — ${property.name}`}>
              {property.articles.map((a) => (
                <Chip
                  key={a.value}
                  label={a.label}
                  role="radio"
                  aria-checked={p.nameArticle === a.value}
                  color={p.nameArticle === a.value ? 'primary' : 'default'}
                  variant={p.nameArticle === a.value ? 'filled' : 'outlined'}
                  onClick={() => set({ nameArticle: a.value })}
                  sx={{ minHeight: 40 }}
                />
              ))}
            </Stack>
            {err('nameArticle') && <Typography variant="caption" color="error">{err('nameArticle')}</Typography>}
            {text('Adresse', p.address, (v) => set({ address: v }), err('address'))}
            {text('Accès', p.access, (v) => set({ access: v }), err('access'), { multiline: true, minRows: 2 })}
            {property.hasWifi && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
                {text('Wi-Fi', p.wifiName, (v) => set({ wifiName: v }), err('wifiName'))}
                {text('Mot de passe Wi-Fi', p.wifiPassword, (v) => set({ wifiPassword: v }), err('wifiPassword'), { type: 'password', placeholder: property.hasWifiPassword ? '••••••' : '' })}
              </Box>
            )}
          </Box>
        );
      })}
      <Typography variant="body2" color="text.secondary">Aperçu — J-2 · Exemple</Typography>
      <EmailPreviewPane subject={preview.subject} body={preview.body} loading={preview.loading} error={preview.error} />
    </Stack>
  );
}
