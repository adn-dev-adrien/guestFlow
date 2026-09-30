/**
 * The operator's profile: the second factor (specs/control-plane-plans-and-access.md rule 31). The
 * new method takes effect once its code is typed, and its 10 backup codes are shown once.
 */
import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PageActionBar from '@gf/components/PageActionBar';
import { useToast } from '@gf/components/DialogProvider';
import KeyValues from '../components/KeyValues';
import api from '../api';

export default function ProfilePage({ operator, onChanged }) {
  const { showError, showSuccess } = useToast();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);

  async function start(method) {
    if (!method) return;
    setCodes(null);
    setCode('');
    try {
      setSetup(await api.mfaStart(method));
    } catch (err) {
      showError(err.message);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    try {
      const res = await api.mfaConfirm(code);
      setSetup(null);
      setCodes(res.backupCodes);
      showSuccess(res.message);
      onChanged(res.operator);
    } catch (err) {
      showError(err.message);
    }
  }

  return (
    <>
      <PageActionBar title="Profil" titleOnXs />
      <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 720 }}>
        <Card>
          <CardContent>
            <Typography variant="sectionHeader" component="h2" sx={{ mb: 1 }}>Double authentification</Typography>
            <KeyValues items={[
              { label: 'Compte', value: operator.email },
              { label: 'Méthode actuelle', value: operator.mfaLabel },
              { label: 'Codes de secours restants', value: String(operator.backupCodesLeft) },
            ]} />
            <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>Changer de méthode :</Typography>
            <ToggleButtonGroup exclusive value={setup ? setup.method : null} onChange={(e, v) => start(v)} sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="totp" sx={{ minHeight: 44 }}>Appli d’authentification</ToggleButton>
              <ToggleButton value="email" sx={{ minHeight: 44 }}>Code par email</ToggleButton>
            </ToggleButtonGroup>
            {setup && (
              <Stack component="form" spacing={2} onSubmit={confirm} sx={{ mt: 2 }}>
                <Typography variant="body2">{setup.message}</Typography>
                {setup.qrDataUrl && (
                  <Box sx={{ textAlign: 'center' }}>
                    <Box component="img" src={setup.qrDataUrl} alt="QR code à scanner" sx={{ width: 200, height: 200 }} />
                    <Typography variant="caption" display="block" color="text.secondary">
                      Ou saisissez la clé : <code>{setup.secret}</code>
                    </Typography>
                  </Box>
                )}
                <TextField label="Code à 6 chiffres" value={code} onChange={(e) => setCode(e.target.value)} required
                  slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }} />
                <Button type="submit" variant="contained" sx={{ minHeight: 44, alignSelf: { sm: 'flex-start' } }}>Activer</Button>
              </Stack>
            )}
            {codes && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Vos 10 codes de secours — notez-les, ils ne s’afficheront plus :</Typography>
                <Box component="ul" sx={{ columns: { xs: 1, sm: 2 }, fontFamily: 'monospace', pl: 2.5 }}>
                  {codes.map((c) => <li key={c}>{c}</li>)}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      </Stack>
    </>
  );
}
