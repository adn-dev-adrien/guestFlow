import React, { useEffect, useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Alert, Stack, CircularProgress } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../hooks/useAuth';

/**
 * Pre-auth login screen. Shown by the AuthGate when there is no session.
 * On success, AuthContext updates and the app (or the forced password-change screen) renders.
 *
 * Reads ?reason=password-changed once after a forced first-login change
 * (specs/admin-account-management.md §3.3 rule 15) and shows a green success Alert. The query
 * param is cleared after rendering so a refresh doesn't re-show it.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (searchParams.get('reason') === 'password-changed') {
      setNotice('Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.');
      // Strip the query so refresh doesn't re-fire the notice.
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err?.error === 'TOO_MANY_ATTEMPTS'
        ? 'Trop de tentatives. Réessayez plus tard.'
        : 'Identifiants invalides.');
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>GuestFlow</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Connectez-vous pour continuer.</Typography>
          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
              {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                fullWidth
                required
              />
              <PasswordField
                label="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
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
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
