/**
 * SecondFactorForm — the second step of a login (specs/hosting-h2-account-security.md rules 7-8):
 * the code (or a backup code), « Faire confiance à cet appareil 30 jours », and « Renvoyer le code »
 * for the email method. Used by the login page and after a password reset, which never bypasses it.
 *
 * Props: step ({ method, message } from the server), onCancel() (back to the password).
 * On success the auth context holds the user and the app renders.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Stack, Typography } from '@mui/material';
import OneTimeCodeField from './OneTimeCodeField';
import api from '../api';
import { useAuth } from '../hooks/useAuth';

export default function SecondFactorForm({ step, onCancel }) {
  const { completeSecondFactor } = useAuth();
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await completeSecondFactor(code, trust);
    } catch (err) {
      if (err && err.error === 'NO_PENDING_LOGIN') {
        onCancel('Reconnexion nécessaire.');
        return;
      }
      setError((err && err.message && err.error !== err.message ? err.message : null) || 'Code incorrect.');
      setCode('');
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      const r = await api.resendSecondFactor();
      setInfo(r.message);
    } catch (err) {
      setError((err && err.message) || 'Envoi impossible.');
    }
  };

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">{step.message}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {info && <Alert severity="info">{info}</Alert>}
        <OneTimeCodeField value={code} onChange={setCode} allowBackup autoFocus helperText="Un code de secours est aussi accepté." />
        <FormControlLabel
          control={<Checkbox checked={trust} onChange={(e) => setTrust(e.target.checked)} />}
          label="Faire confiance à cet appareil 30 jours"
          sx={{ minHeight: 44 }}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={busy || code.length < 6}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
        >
          Valider
        </Button>
        <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button onClick={() => onCancel()} sx={{ minHeight: 44 }}>Retour</Button>
          {step.method === 'email' && <Button onClick={resend} sx={{ minHeight: 44 }}>Renvoyer le code</Button>}
        </Stack>
      </Stack>
    </Box>
  );
}
