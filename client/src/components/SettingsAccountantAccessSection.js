/**
 * SettingsAccountantAccessSection — admin-only "Accès comptable" block.
 *
 * Creates the accountant account if none exists, or resets its password if one does. The accountant
 * logs in with the temporary password and is forced to change it on first login (server-side via
 * `mustChangePassword`).
 *
 * Self-contained: fetches `/api/users` to detect an existing accountant.
 */
import React, { useEffect, useState } from 'react';
import {
  Card, CardContent, Stack, Typography, TextField, Button, Alert, Box,
} from '@mui/material';
import api from '../api';

function generateTempPassword() {
  // 12 chars: ensures the server's PASSWORD_TOO_SHORT (≥10) guard passes with margin.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default function SettingsAccountantAccessSection() {
  const [existing, setExisting] = useState(null); // null = unknown / not yet loaded; undefined = none
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listUsers();
      const accountant = (data.users || []).find((u) => u.role === 'accountant');
      setExisting(accountant || undefined);
      if (accountant) setEmail(accountant.email);
    } catch (err) {
      setError(err.message || 'Impossible de charger les comptes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      if (existing) {
        await api.resetUserPassword(existing.id, password);
        setMessage(`Mot de passe réinitialisé. Communiquez-le au comptable : il devra le changer à la première connexion.`);
      } else {
        await api.createUser({ email, password, role: 'accountant' });
        setMessage(`Compte créé. Communiquez l'email + le mot de passe au comptable : il devra le changer à la première connexion.`);
        await refresh();
      }
      setPassword('');
    } catch (err) {
      const code = err.error || err.message || '';
      const map = {
        INVALID_EMAIL: 'Email invalide.',
        PASSWORD_TOO_SHORT: 'Mot de passe trop court (10 caractères minimum).',
        EMAIL_ALREADY_EXISTS: 'Un compte existe déjà avec cet email.',
        INVALID_ROLE: 'Rôle invalide.',
      };
      setError(map[code] || code || 'Erreur inconnue.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = () => {
    setPassword(generateTempPassword());
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Accès comptable</Typography>
            <Typography variant="body2" color="text.secondary">
              {existing
                ? `Un compte comptable existe : ${existing.email}. Vous pouvez réinitialiser son mot de passe.`
                : 'Créez un identifiant pour votre comptable. Il pourra se connecter à la page Comptabilité (lecture seule) et changer son mot de passe.'}
            </Typography>
          </Box>

          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Email du comptable"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={Boolean(existing) || loading || submitting}
              fullWidth
            />
            <TextField
              label={existing ? 'Nouveau mot de passe' : 'Mot de passe temporaire'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || submitting}
              fullWidth
              helperText="10 caractères minimum."
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="outlined" onClick={handleGenerate} disabled={loading || submitting}>
              Générer un mot de passe
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSubmit}
              disabled={loading || submitting || !password || (!existing && !email)}
            >
              {existing ? 'Réinitialiser le mot de passe' : 'Créer le compte comptable'}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
