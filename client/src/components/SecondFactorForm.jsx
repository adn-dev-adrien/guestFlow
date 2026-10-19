/**
 * SecondFactorForm — the second step of a login (specs/hosting-h2-account-security.md rules 7-8):
 * the code (or a backup code), « Se souvenir de cet appareil (30 jours) », and « Renvoyer le code »
 * for the email method. The code is sent at its 6th digit, with no « Valider » button (rule 32).
 * Used by the login page and after a password reset, which never bypasses it.
 *
 * Props: step ({ method, message } from the server), onCancel() (back to the password).
 * On success the auth context holds the user and the app renders.
 */
import React, { useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import OneTimeCodeField, { isCompleteCode } from './OneTimeCodeField';
import api from '../api';
import { useAuth } from '../hooks/useAuth';

export default function SecondFactorForm({ step, onCancel }) {
  const { completeSecondFactor } = useAuth();
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Rule 32: called by the field at the 6th digit (or a whole backup code), and by Enter. The ref
  // keeps a second call out while the first is on its way.
  const verify = async (value) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await completeSecondFactor(value, trust);
    } catch (err) {
      if (err && err.error === 'NO_PENDING_LOGIN') {
        onCancel('Reconnexion nécessaire.');
        return;
      }
      setError((err && err.message && err.error !== err.message ? err.message : null) || 'Code incorrect.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (isCompleteCode(code, true)) verify(code);
  };

  const change = (value) => {
    setCode(value);
    setError('');
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
    <Box component="form" onSubmit={submit} noValidate>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">{step.message}</Typography>
        {/* Above the code: the code is sent as soon as it is complete, autofill included. */}
        <FormControlLabel
          control={<Checkbox checked={trust} onChange={(e) => setTrust(e.target.checked)} />}
          label="Se souvenir de cet appareil (30 jours)"
          sx={{ minHeight: 44 }}
        />
        <OneTimeCodeField
          value={code}
          onChange={change}
          onComplete={verify}
          allowBackup
          primaryLinkLabel={step.method === 'email' ? 'Utiliser le code reçu par email' : 'Utiliser le code de l’application'}
          error={error}
          helperText={busy ? 'Vérification…' : info}
          autoFocus
        />
        <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button onClick={() => onCancel()} sx={{ minHeight: 44 }}>Retour</Button>
          {step.method === 'email' && <Button onClick={resend} sx={{ minHeight: 44 }}>Renvoyer le code</Button>}
        </Stack>
      </Stack>
    </Box>
  );
}
