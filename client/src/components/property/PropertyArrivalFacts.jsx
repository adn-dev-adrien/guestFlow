/**
 * PropertyArrivalFacts — « Arrivée » block of the property's Séjour tab
 * (specs/guest-email-texts-made-simple.md rules 1–2): address, map link, how to get in (FR/EN), the
 * key-box code and the Wi-Fi. The J-2 composes its arrival paragraphs from them. The code and the
 * Wi-Fi password are secrets: shown masked, sent only when typed. Specific to the property page.
 *
 * Controlled (rule 34): the page holds the draft, so its own Enregistrer / Annuler and its
 * unsaved-changes guard cover these fields like any other of the page.
 *
 * Props:
 *   draft     { address, mapUrl, accessFr, accessEn, wifiName, accessCode?, wifiPassword? }
 *   saved     { hasAccessCode, hasWifiPassword } — what is stored, for the masked fields
 *   errors    { [field]: message }
 *   onChange  (field, value) => void
 *   propertyId, hasWifi (boolean — without Wi-Fi the Wi-Fi fields are not asked)
 */
import React from 'react';
import { Box, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import MaskedTextField from '../MaskedTextField';
import HelpedTextField from '../HelpedTextField';

export default function PropertyArrivalFacts({ draft, saved, errors = {}, onChange, propertyId, hasWifi = true }) {
  const set = (key) => (e) => onChange(key, typeof e === 'string' ? e : e.target.value);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" sx={{ display: 'block' }}>Arrivée</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Repris dans le mail J-2. Vide : pas de paragraphe.
        </Typography>
        <Stack spacing={2}>
          <TextField label="Adresse" value={draft.address} onChange={set('address')} size="small" fullWidth error={Boolean(errors.address)} helperText={errors.address} />
          <HelpedTextField label="Lien carte" value={draft.mapUrl} onChange={set('mapUrl')} helperText="Vide : construit depuis l’adresse" size="small" fullWidth error={errors.mapUrl} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Accès (français)" value={draft.accessFr} onChange={set('accessFr')} size="small" multiline minRows={2} fullWidth error={Boolean(errors.accessFr)} helperText={errors.accessFr} />
            <TextField label="Accès (anglais)" value={draft.accessEn} onChange={set('accessEn')} size="small" multiline minRows={2} fullWidth placeholder="Vide : le français" error={Boolean(errors.accessEn)} helperText={errors.accessEn} />
          </Box>
          <MaskedTextField
            label="Code de la boîte à clés"
            hasValue={saved.hasAccessCode}
            value={draft.accessCode}
            onChange={(v) => onChange('accessCode', v)}
          />
          {hasWifi && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
            <TextField label="Réseau Wi-Fi" value={draft.wifiName} onChange={set('wifiName')} size="small" fullWidth />
            <MaskedTextField
              label="Mot de passe Wi-Fi"
              hasValue={saved.hasWifiPassword}
              value={draft.wifiPassword}
              onChange={(v) => onChange('wifiPassword', v)}
            />
          </Box>}
          <Link component={RouterLink} to={`/settings/emails/textes?propertyId=${propertyId}#j2`}>Textes des emails</Link>
        </Stack>
      </CardContent>
    </Card>
  );
}
