/**
 * PropertyArrivalFacts — « Arrivée » block of the property's Séjour tab
 * (specs/guest-email-texts-made-simple.md rules 1–2): address, map link, how to get in (FR/EN), the
 * key-box code and the Wi-Fi. The J-2 composes its arrival paragraphs from them. The code and the
 * Wi-Fi password are secrets: shown masked, sent only when typed. Saved on its own, like the property's
 * texts: it is not part of the property form. Specific to the property page.
 *
 * Props: propertyId (number), hasWifi (boolean — without Wi-Fi the Wi-Fi fields are not asked)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import api from '../../api';
import MaskedTextField from '../MaskedTextField';
import HelpedTextField from '../HelpedTextField';
import { useToast } from '../DialogProvider';

const PLAIN = ['address', 'mapUrl', 'accessFr', 'accessEn', 'wifiName'];

export default function PropertyArrivalFacts({ propertyId, hasWifi = true }) {
  const { showSuccess, showError } = useToast();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({});
  const [secrets, setSecrets] = useState({ accessCode: undefined, wifiPassword: undefined });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getPropertyArrivalFacts(propertyId)
      .then((facts) => { setSaved(facts); setForm(Object.fromEntries(PLAIN.map((k) => [k, facts[k] || '']))); setSecrets({ accessCode: undefined, wifiPassword: undefined }); })
      .catch(() => setSaved(null));
  }, [propertyId]);
  useEffect(() => { load(); }, [load]);

  if (!saved) return null;
  const dirty = PLAIN.some((k) => form[k] !== (saved[k] || '')) || secrets.accessCode !== undefined || secrets.wifiPassword !== undefined;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: typeof e === 'string' ? e : e.target.value }));

  async function save() {
    setBusy(true);
    try {
      const body = { ...form };
      if (secrets.accessCode !== undefined) body.accessCode = secrets.accessCode;
      if (secrets.wifiPassword !== undefined) body.wifiPassword = secrets.wifiPassword;
      await api.savePropertyArrivalFacts(propertyId, body);
      setErrors({});
      showSuccess('Arrivée enregistrée.');
      load();
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      else showError(err.message || 'Enregistrement impossible.');
    }
    setBusy(false);
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader" sx={{ display: 'block' }}>Arrivée</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Repris dans le mail J-2. Vide : pas de paragraphe.
        </Typography>
        <Stack spacing={2}>
          <TextField label="Adresse" value={form.address} onChange={set('address')} size="small" fullWidth error={Boolean(errors.address)} helperText={errors.address} />
          <HelpedTextField label="Lien carte" value={form.mapUrl} onChange={set('mapUrl')} helperText="Vide : construit depuis l’adresse" size="small" fullWidth error={errors.mapUrl} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Accès (français)" value={form.accessFr} onChange={set('accessFr')} size="small" multiline minRows={2} fullWidth />
            <TextField label="Accès (anglais)" value={form.accessEn} onChange={set('accessEn')} size="small" multiline minRows={2} fullWidth placeholder="Vide : le français" />
          </Box>
          <MaskedTextField
            label="Code de la boîte à clés"
            hasValue={saved.hasAccessCode}
            value={secrets.accessCode}
            onChange={(v) => setSecrets((s) => ({ ...s, accessCode: v }))}
          />
          {hasWifi && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
            <TextField label="Réseau Wi-Fi" value={form.wifiName} onChange={set('wifiName')} size="small" fullWidth />
            <MaskedTextField
              label="Mot de passe Wi-Fi"
              hasValue={saved.hasWifiPassword}
              value={secrets.wifiPassword}
              onChange={(v) => setSecrets((s) => ({ ...s, wifiPassword: v }))}
            />
          </Box>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="contained" onClick={save} disabled={!dirty || busy} sx={{ minHeight: 44 }}>Enregistrer l’arrivée</Button>
            <Link component={RouterLink} to={`/settings/emails/textes?propertyId=${propertyId}#j2`}>Textes des emails</Link>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
