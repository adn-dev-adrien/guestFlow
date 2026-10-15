/**
 * ResetPasswordPage — « Nouveau mot de passe » at `/nouveau-mot-de-passe?token=…`, opened from the
 * reset email (specs/hosting-h2-account-security.md rule 4). The existing password rules apply
 * (10 characters at least, confirmation); saving logs the user in — through the second step when the
 * account has one, which a reset never bypasses.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router';
import AuthCard from '../components/AuthCard';
import PasswordField from '../components/PasswordField';
import SecondFactorForm from '../components/SecondFactorForm';
import LoadingState from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import api from '../api';

const MIN_LENGTH = 10;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { resetPassword } = useAuth();
  const [valid, setValid] = useState(null);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null);

  useEffect(() => {
    let alive = true;
    api.checkResetToken(token)
      .then((r) => { if (alive) setValid(Boolean(r && r.valid)); })
      .catch(() => { if (alive) setValid(false); });
    return () => { alive = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < MIN_LENGTH) { setError(`Au moins ${MIN_LENGTH} caractères.`); return; }
    if (next !== confirm) { setError('La confirmation ne correspond pas.'); return; }
    setBusy(true);
    try {
      const result = await resetPassword(token, next);
      if (result && result.step) setStep(result);
    } catch (err) {
      if (err && err.error === 'INVALID_TOKEN') setValid(false);
      else setError((err && err.message) || 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (step) {
    return (
      <AuthCard title="Second code">
        <Alert severity="success" sx={{ mb: 2 }}>Mot de passe enregistré.</Alert>
        <SecondFactorForm step={step} onCancel={() => window.location.assign('/login')} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nouveau mot de passe">
      {valid === null && <LoadingState />}
      {valid === false && (
        <Stack spacing={2}>
          <Alert severity="error">Lien expiré ou déjà utilisé.</Alert>
          <Link component={RouterLink} to="/mot-de-passe-oublie" variant="body2" sx={{ textAlign: 'center', py: 1 }}>
            Demander un nouveau lien
          </Link>
        </Stack>
      )}
      {valid && (
        <Box component="form" onSubmit={submit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <PasswordField
              label="Nouveau mot de passe"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              helperText={`Au moins ${MIN_LENGTH} caractères.`}
              autoFocus
              fullWidth
              required
            />
            <PasswordField
              label="Confirmer le nouveau mot de passe"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              fullWidth
              required
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy}
              startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
            >
              Enregistrer
            </Button>
          </Stack>
        </Box>
      )}
    </AuthCard>
  );
}
