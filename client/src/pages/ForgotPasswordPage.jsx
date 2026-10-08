/**
 * ForgotPasswordPage — « Mot de passe oublié » at `/mot-de-passe-oublie`, before any session
 * (specs/hosting-h2-account-security.md rules 1, 3). The answer is the server's, the same whether the
 * address has an account or not.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import AuthCard from '../components/AuthCard';
import api from '../api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.forgotPassword(email.trim());
      setAnswer(r.message);
    } catch {
      setError('Envoi impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Mot de passe oublié" subtitle="Un lien de réinitialisation part à l’adresse du compte.">
      <Box component="form" onSubmit={submit}>
        <Stack spacing={2}>
          {answer && <Alert severity="success">{answer}</Alert>}
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
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
          >
            Envoyer le lien
          </Button>
          <Link component={RouterLink} to="/login" variant="body2" sx={{ textAlign: 'center', py: 1 }}>
            Retour à la connexion
          </Link>
        </Stack>
      </Box>
    </AuthCard>
  );
}
