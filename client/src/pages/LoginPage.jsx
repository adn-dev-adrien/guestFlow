import React, { useEffect, useState } from 'react';
import { Box, TextField, Button, Alert, Stack, CircularProgress, Link } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import PasswordField from '../components/PasswordField';
import AuthCard from '../components/AuthCard';
import SecondFactorForm from '../components/SecondFactorForm';
import { useAuth } from '../hooks/useAuth';
import api from '../api';

/**
 * Pre-auth login screen. Shown by the AuthGate when there is no session.
 * On success, AuthContext updates and the app (or the forced password-change screen) renders.
 *
 * Reads ?reason=password-changed once after a forced first-login change
 * (specs/admin-account-management.md §3.3 rule 15) and shows a green success Alert. The query
 * param is cleared after rendering so a refresh doesn't re-show it. `?reason=support-link` says a
 * support sign-in link was refused (specs/hosting-h2-account-security.md rule 14).
 *
 * `?login_hint=<email>` comes from the shared login page: the email is filled in and the focus goes
 * to the password (specs/control-plane-plans-and-access.md rule 24).
 *
 * An account with a second step gets it after the password (specs/hosting-h2-account-security.md
 * rule 7); « Mot de passe oublié ? » shows when the instance can send the link (rule 5).
 */
const REASONS = {
  'password-changed': { severity: 'success', text: 'Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.' },
  'support-link': { severity: 'error', text: 'Lien support invalide ou expiré.' },
};

export default function LoginPage() {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loginHint = searchParams.get('login_hint') || '';
  const [email, setEmail] = useState(loginHint);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState(null);
  const [forgotAvailable, setForgotAvailable] = useState(false);

  useEffect(() => {
    const reason = REASONS[searchParams.get('reason')];
    if (reason) {
      setNotice(reason);
      // Strip the query so refresh doesn't re-fire the notice.
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    let alive = true;
    api.getAuthOptions()
      .then((o) => { if (alive) setForgotAvailable(Boolean(o && o.forgotPassword)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await login(email.trim(), password);
      if (result && result.step) {
        setStep(result);
        setBusy(false);
      }
    } catch (err) {
      setError(err?.error === 'TOO_MANY_ATTEMPTS'
        ? 'Trop de tentatives. Réessayez plus tard.'
        : err?.error === 'LOCKED' ? err.message : 'Identifiants invalides.');
      setBusy(false);
    }
  };

  if (step) {
    return (
      <AuthCard title="Second code">
        <SecondFactorForm
          step={step}
          onCancel={(message) => { setStep(null); setPassword(''); setError(message || ''); }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="Connectez-vous pour continuer.">
      <Box component="form" onSubmit={submit}>
        <Stack spacing={2}>
          {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus={!loginHint}
            fullWidth
            required
          />
          <PasswordField
            label="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus={Boolean(loginHint)}
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
            Se connecter
          </Button>
          {forgotAvailable && (
            <Link component={RouterLink} to="/mot-de-passe-oublie" variant="body2" sx={{ textAlign: 'center', py: 1 }}>
              Mot de passe oublié ?
            </Link>
          )}
        </Stack>
      </Box>
    </AuthCard>
  );
}
