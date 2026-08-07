import React, { useState } from 'react';
import { Box, Button, Alert, Stack, CircularProgress } from '@mui/material';
import PasswordField from './PasswordField';

/**
 * ChangePasswordForm — reusable current/new/confirm password form.
 *
 * Props:
 *  - onSubmit(currentPassword, newPassword): async; should throw an Error with `.error` code on failure.
 *  - submitLabel?: string (default "Changer le mot de passe")
 *  - currentLabel?: string (default "Mot de passe actuel")
 *  - onSuccess?: () => void (called after a successful change)
 *
 * Client-side checks mirror the server (min 10 chars, must differ, confirmation match); the server
 * remains authoritative.
 */
const MIN_LENGTH = 10;

const ERROR_FR = {
  PASSWORD_TOO_SHORT: `Le nouveau mot de passe doit faire au moins ${MIN_LENGTH} caractères.`,
  PASSWORD_UNCHANGED: 'Le nouveau mot de passe doit être différent de l\'actuel.',
  INVALID_CREDENTIALS: 'Mot de passe actuel incorrect.',
  MISSING_FIELDS: 'Veuillez remplir tous les champs.',
};

export default function ChangePasswordForm({
  onSubmit,
  submitLabel = 'Changer le mot de passe',
  currentLabel = 'Mot de passe actuel',
  onSuccess,
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < MIN_LENGTH) { setError(ERROR_FR.PASSWORD_TOO_SHORT); return; }
    if (next !== confirm) { setError('La confirmation ne correspond pas.'); return; }
    if (next === current) { setError(ERROR_FR.PASSWORD_UNCHANGED); return; }
    setBusy(true);
    try {
      await onSubmit(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(ERROR_FR[err?.error] || err?.message || 'Échec du changement de mot de passe.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <PasswordField
          label={currentLabel}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          fullWidth
          required
        />
        <PasswordField
          label="Nouveau mot de passe"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          helperText={`Au moins ${MIN_LENGTH} caractères.`}
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
          disabled={busy}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
        >
          {submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}
