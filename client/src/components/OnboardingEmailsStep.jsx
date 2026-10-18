/**
 * OnboardingEmailsStep — step « Emails » of the start assistant (specs/guest-email-texts-made-simple.md
 * rule 21): phone and sender name, then for every property its article as a choice, its address (the
 * company's offered by the server), way in, key-box code and Wi-Fi, the deposit, the cleaning, the
 * bath towels and the bed linen; then the J-2 of a sample stay rendered by the server with what is
 * typed. Every field can be left empty: an article, a deposit, the cleaning or the linen left unanswered are not said
 * to the guest (rules 27, 29). Specific to the assistant.
 *
 * Props:
 *   emails     the server's `emails` block of GET /api/onboarding
 *   value      { phone, senderName, properties: { [id]: { nameArticle, address, access, accessCode, wifiName,
 *              wifiPassword, caution, cleaningIncluded, towelsProvided, bedLinenProvided } } } — null / '' while unanswered
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
      draft.arrival[id] = {
        address: p.address, accessFr: p.access, wifiName: p.wifiName,
        ...(p.wifiPassword ? { wifiPassword: p.wifiPassword } : {}),
        ...(p.accessCode ? { accessCode: p.accessCode } : {}),
      };
      draft.properties[id] = {
        ...(p.nameArticle ? { nameArticle: p.nameArticle } : {}),
        ...(p.caution !== '' && p.caution != null ? { caution: p.caution } : {}),
        ...(p.cleaningIncluded != null ? { cleaningIncluded: p.cleaningIncluded } : {}),
        ...(p.towelsProvided != null ? { towelsProvided: p.towelsProvided } : {}),
        ...(p.bedLinenProvided != null ? { bedLinenProvided: p.bedLinenProvided } : {}),
      };
    }
    const timer = setTimeout(() => {
      api.previewEmailDraft({ stableKey: emails.previewStableKey, reservationId: 'sample', propertyId: first && first.id, draft })
        .then((r) => setPreview({ subject: r.subject, body: r.body, loading: false, error: '' }))
        .catch((err) => setPreview({ subject: '', body: '', loading: false, error: err.message || 'Aperçu impossible.' }));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, emails.previewStableKey, first]);

  // Two answers and no default: nothing is chosen until the owner chooses (rule 27).
  const yesNo = (label, current, onPick, yes, no) => (
    <Box sx={{ pb: 1.5 }}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{label}</Typography>
      <Stack direction="row" spacing={1} role="radiogroup" aria-label={label}>
        {[[true, yes], [false, no]].map(([flag, text]) => (
          <Chip
            key={text}
            label={text}
            role="radio"
            aria-checked={current === flag}
            color={current === flag ? 'primary' : 'default'}
            variant={current === flag ? 'filled' : 'outlined'}
            onClick={() => onPick(current === flag ? null : flag)}
            sx={{ minHeight: 40 }}
          />
        ))}
      </Stack>
    </Box>
  );

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
            {/* Rule 31 — the code has its own field: it never sits in a text, nor in the exported file. */}
            {text('Code de la boîte à clés', p.accessCode, (v) => set({ accessCode: v }), err('accessCode'), {
              type: 'password', autoComplete: 'off', placeholder: property.hasAccessCode ? '••••••' : '',
            })}
            {property.hasWifi && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
                {text('Wi-Fi', p.wifiName, (v) => set({ wifiName: v }), err('wifiName'))}
                {text('Mot de passe Wi-Fi', p.wifiPassword, (v) => set({ wifiPassword: v }), err('wifiPassword'), { type: 'password', placeholder: property.hasWifiPassword ? '••••••' : '' })}
              </Box>
            )}
            {text('Caution (€)', p.caution, (v) => set({ caution: v }), err('caution'), {
              type: 'number', helperText: err('caution') || 'Vide : aucune caution annoncée.', slotProps: { htmlInput: { min: 0, step: 50 } },
            })}
            {yesNo('Ménage de fin de séjour', p.cleaningIncluded, (v) => set({ cleaningIncluded: v }), 'Compris', 'Non compris')}
            {yesNo('Linge de toilette', p.towelsProvided, (v) => set({ towelsProvided: v }), 'Fourni', 'À apporter')}
            {yesNo('Linge de lit', p.bedLinenProvided, (v) => set({ bedLinenProvided: v }), 'Fourni', 'À apporter')}
          </Box>
        );
      })}
      <Typography variant="body2" color="text.secondary">Aperçu — J-2 · Exemple</Typography>
      <EmailPreviewPane subject={preview.subject} body={preview.body} loading={preview.loading} error={preview.error} />
    </Stack>
  );
}
