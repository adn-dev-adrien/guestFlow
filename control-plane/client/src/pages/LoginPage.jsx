/**
 * The console's login (specs/control-plane-plans-and-access.md rule 31): email and password, then
 * the second factor the operator chose — the authenticator app's code or the code sent by email —
 * or one of their backup codes.
 */
import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import api from '../api';

export default function LoginPage({ onSignedIn }) {
  const [step, setStep] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      if (err.code === 'LOCKED' || err.code === 'NO_PENDING_LOGIN') setStep(null);
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e) => {
    e.preventDefault();
    run(async () => setStep(await api.login(email, password)));
  };
  const submitCode = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.verify(code);
      onSignedIn(res.operator, res.notice);
    });
  };
  const resend = () => run(async () => setInfo((await api.resend()).message));

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="pageTitle" component="h1" sx={{ textAlign: 'center', mb: 2 }}>
            {step ? 'Vérification' : 'Console GuestFlow'}
          </Typography>
          {!step ? (
            <Stack component="form" spacing={2} onSubmit={submitPassword}>
              <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required fullWidth />
              <TextField label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth />
              {error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}
              <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>Se connecter</Button>
            </Stack>
          ) : (
            <Stack component="form" spacing={2} onSubmit={submitCode}>
              <Typography variant="body2">
                {backup ? 'Saisissez un de vos codes de secours (format xxxxx-xxxxx).' : step.message}
              </Typography>
              <TextField
                label={backup ? 'Code de secours' : 'Code'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
                fullWidth
                slotProps={{ htmlInput: { inputMode: backup ? 'text' : 'numeric', autoComplete: 'one-time-code' } }}
              />
              {error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}
              {info && <Typography color="success.main" variant="body2">{info}</Typography>}
              <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>Valider</Button>
              <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {step.method === 'email' && !backup && (
                  <Link component="button" type="button" onClick={resend} sx={{ minHeight: 44 }}>Renvoyer le code</Link>
                )}
                <Link component="button" type="button" onClick={() => { setBackup(!backup); setCode(''); }} sx={{ minHeight: 44 }}>
                  {backup ? 'Revenir au code' : 'Utiliser un code de secours'}
                </Link>
                <Link component="button" type="button" onClick={() => { setStep(null); setCode(''); setBackup(false); setError(''); setInfo(''); }} sx={{ minHeight: 44 }}>
                  Changer d’email
                </Link>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
