/**
 * SettingsSmtpSection — "Envoi d'emails (SMTP)" card in /parametres.
 *
 * Configures the SMTP transport used by the account-management flow
 * (specs/admin-account-management.md M3) to email temporary passwords to newly-created or
 * reset-password users. The password field uses MaskedTextField — the cleartext only leaves the
 * UI on save, and the server-side encrypted blob is never returned (the server only sends back a
 * `passwordSet: boolean`).
 *
 * Props:
 *   values:      { host, port, secure, username, passwordSet, fromEmail, fromName, publicUrl,
 *                  passwordDraft?: string | undefined }
 *                passwordDraft semantics (mirrors GoogleCalendarSection's privateKeyDraft):
 *                  undefined → preserve the existing value on save
 *                  ''        → explicit clear
 *                  'value'   → store
 *   errors:      { smtpHost?, smtpPort?, smtpFromEmail?, publicUrl? }   (server-side validation)
 *   onChange:    (key, value) => void   — key is one of the `values` field names
 *   onChangePassword: (value: string | undefined) => void   — passwordDraft setter
 *   onSendTest:  () => Promise          — triggers POST /api/settings/smtp-test
 *   testing:     boolean                — spinner on the test button
 *   testResult:  { severity, message } | null
 *   disabled:    boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, TextField, Box, Button, MenuItem, Alert, CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MaskedTextField from './MaskedTextField';

export default function SettingsSmtpSection({
  values,
  errors = {},
  onChange,
  onChangePassword,
  onSendTest,
  testing = false,
  testResult,
  disabled = false,
}) {
  const v = values || {};
  const setEvt = (k) => (e) => onChange(k, e.target.value);

  // The "Envoyer un mail de test" button is disabled until the SMTP block is complete in the draft:
  // a host, a fromEmail and either a saved password (passwordSet) or a draft password.
  const hasPassword = v.passwordSet || (v.passwordDraft && v.passwordDraft.trim() !== '');
  const canTest = !disabled && !testing
    && String(v.host || '').trim() !== ''
    && String(v.fromEmail || '').trim() !== ''
    && hasPassword;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Envoi d'emails (SMTP)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Identifiants utilisés pour envoyer les mots de passe provisoires lors de la création
              ou de la réinitialisation d'un compte. Le mot de passe SMTP est chiffré en base.
            </Typography>
          </Box>

          <TextField
            label="Hôte SMTP"
            value={v.host || ''}
            onChange={setEvt('host')}
            disabled={disabled}
            error={Boolean(errors.smtpHost)}
            helperText={errors.smtpHost || 'Exemple : smtp.gmail.com'}
            fullWidth
            size="small"
          />

          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              label="Port"
              type="number"
              value={v.port == null ? '' : v.port}
              onChange={(e) => onChange('port', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={disabled}
              error={Boolean(errors.smtpPort)}
              helperText={errors.smtpPort || 'Souvent 587 (STARTTLS) ou 465 (TLS implicite)'}
              size="small"
              sx={{ width: { xs: '100%', sm: 200 } }}
              inputProps={{ min: 1, max: 65535 }}
            />
            <TextField
              label="Sécurité"
              select
              value={v.secure ? 1 : 0}
              onChange={(e) => onChange('secure', Number(e.target.value) === 1)}
              disabled={disabled}
              size="small"
              sx={{ width: { xs: '100%', sm: 280 } }}
              helperText="STARTTLS (port 587) ou TLS implicite (port 465)"
            >
              <MenuItem value={0}>STARTTLS (port 587)</MenuItem>
              <MenuItem value={1}>TLS implicite (port 465)</MenuItem>
            </TextField>
          </Box>

          <TextField
            label="Utilisateur SMTP"
            value={v.username || ''}
            onChange={setEvt('username')}
            disabled={disabled}
            helperText="Souvent identique à l'adresse expéditeur."
            fullWidth
            size="small"
          />

          <MaskedTextField
            label="Mot de passe SMTP"
            hasValue={Boolean(v.passwordSet)}
            value={v.passwordDraft}
            onChange={onChangePassword}
            helperText="Stocké chiffré (AES-256-GCM). Pour Gmail, utilisez un mot de passe d'application."
          />

          <TextField
            label="Adresse expéditeur"
            value={v.fromEmail || ''}
            onChange={setEvt('fromEmail')}
            disabled={disabled}
            error={Boolean(errors.smtpFromEmail)}
            helperText={errors.smtpFromEmail || 'Adresse affichée comme « From » dans les emails envoyés.'}
            fullWidth
            size="small"
          />

          <TextField
            label="Nom expéditeur"
            value={v.fromName || ''}
            onChange={setEvt('fromName')}
            disabled={disabled}
            helperText="Nom affiché aux destinataires (par défaut : GuestFlow)."
            fullWidth
            size="small"
          />

          <TextField
            label="URL publique de l'application"
            value={v.publicUrl || ''}
            onChange={setEvt('publicUrl')}
            disabled={disabled}
            error={Boolean(errors.publicUrl)}
            helperText={errors.publicUrl || "Cette URL est insérée dans les emails envoyés aux utilisateurs (ex. https://guestflow.adn-dev.fr)."}
            fullWidth
            size="small"
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button
              variant="outlined"
              color="primary"
              startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
              onClick={onSendTest}
              disabled={!canTest}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
            >
              Envoyer un mail de test
            </Button>
            <Typography variant="caption" color="text.secondary">
              Envoie « Email de test GuestFlow » à votre propre adresse pour valider la configuration.
            </Typography>
            {testResult && (
              <Alert severity={testResult.severity} onClose={testResult.onClose}>
                {testResult.message}
              </Alert>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
