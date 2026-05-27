import React, { useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Alert, Stack, CircularProgress } from '@mui/material';
import { useAuth } from '../hooks/useAuth';

/**
 * Pre-auth login screen. Shown by the AuthGate when there is no session.
 * On success, AuthContext updates and the app (or the forced password-change screen) renders.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
              <TextField
                label="Mot de passe"
                type="password"
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
