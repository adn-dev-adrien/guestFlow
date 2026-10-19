/**
 * The console's login (specs/control-plane-plans-and-access.md rule 31): email and password, then
 * the second factor the operator chose — the authenticator app's code or the code sent by email —
 * or one of their backup codes. The code field is the instance's (specs/hosting-h2-account-security.md
 * rules 32–34): six cells, sent at the 6th digit, the refusal under the cells.
 */
import React, { useRef, useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import OneTimeCodeField, { incompleteCodeMessage, isCompleteCode } from '@gf/components/OneTimeCodeField';
import api from '../api';

export default function LoginPage({ onSignedIn }) {
  const [step, setStep] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const verifying = useRef(false);

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
  const verify = async (value) => {
    if (verifying.current) return;
    verifying.current = true;
    setInfo('');
    await run(async () => {
      const res = await api.verify(value);
      onSignedIn(res.operator, res.notice);
    });
    verifying.current = false;
  };
  const submitCode = (e) => {
    e.preventDefault();
    if (isCompleteCode(code, true)) verify(code);
    else setError(incompleteCodeMessage(code));
  };
  const changeCode = (value) => {
    setCode(value);
    setError('');
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
            <Stack component="form" spacing={1.5} onSubmit={submitCode} noValidate>
              <Typography variant="body2" color="text.secondary">{step.message}</Typography>
              <OneTimeCodeField
                value={code}
                onChange={changeCode}
                onComplete={verify}
                allowBackup
                primaryLinkLabel={step.method === 'email' ? 'Utiliser le code reçu par email' : 'Utiliser le code de l’application'}
                error={error}
                helperText={busy ? 'Vérification…' : info}
                autoFocus
              />
              <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Link component="button" type="button" onClick={() => { setStep(null); setCode(''); setError(''); setInfo(''); }} sx={{ minHeight: 44 }}>
                  Changer d’email
                </Link>
                {step.method === 'email' && (
                  <Link component="button" type="button" onClick={resend} sx={{ minHeight: 44 }}>Renvoyer le code</Link>
                )}
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
