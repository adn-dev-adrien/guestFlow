/**
 * SettingsSmtpSection — « Envoi » card of Paramètres → Emails & notifications.
 *
 * The SMTP transport GuestFlow sends every email with. The password uses MaskedTextField — the
 * cleartext only leaves the UI on save, and the server never returns it (only `passwordSet`).
 * The sending address, SMTP login and sender name are DERIVED unless overridden
 * (specs/settings-rationalization.md rule 12): each one is a DerivedValueField showing what it
 * falls back to (`values.derived`, computed by the server). No port field: it follows the security
 * mode (rule 11). The public URL moved to the Système page.
 *
 * Props:
 *   values:      { host, secure, username, passwordSet, fromEmail, fromName,
 *                  derived: { fromEmail, username, fromName }, passwordDraft?: string | undefined }
 *                passwordDraft: undefined → preserve, '' → clear, 'value' → store
 *   errors:      { smtpHost?, smtpFromEmail?, smtpFromName? } (server-side validation)
 *   onChange:    (key, value) => void
 *   onChangePassword: (value: string | undefined) => void
 *   onSendTest:  () => Promise          — triggers POST /api/settings/smtp-test
 *   testing:     boolean                — spinner on the test button
 *   testResult:  { severity, message, onClose } | null
 *   disabled:    boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, TextField, Box, Button, MenuItem, Alert, CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MaskedTextField from './MaskedTextField';
import DerivedValueField from './DerivedValueField';

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
  const derived = v.derived || {};
  const setEvt = (k) => (e) => onChange(k, e.target.value);

  // « Envoyer un mail de test » needs a host, a sending address (override or derived) and a
  // password — saved (passwordSet) or typed in the draft.
  const hasPassword = v.passwordSet || (v.passwordDraft && v.passwordDraft.trim() !== '');
  const sendingAddress = String(v.fromEmail || '').trim() || String(derived.fromEmail || '').trim();
  const canTest = !disabled && !testing
    && String(v.host || '').trim() !== ''
    && sendingAddress !== ''
    && hasPassword;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Envoi</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Le serveur qui envoie les emails de GuestFlow.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Serveur SMTP"
              value={v.host || ''}
              onChange={setEvt('host')}
              disabled={disabled}
              error={Boolean(errors.smtpHost)}
              helperText={errors.smtpHost || 'Exemple : smtp.gmail.com'}
              fullWidth
              size="small"
            />
            <TextField
              label="Sécurité"
              select
              value={v.secure ? 1 : 0}
              onChange={(e) => onChange('secure', Number(e.target.value) === 1)}
              disabled={disabled}
              size="small"
              fullWidth
              helperText={`Port utilisé : ${v.secure ? 465 : 587} (déduit).`}
            >
              <MenuItem value={0}>STARTTLS</MenuItem>
              <MenuItem value={1}>TLS implicite</MenuItem>
            </TextField>
          </Stack>

          <DerivedValueField
            label="Adresse d'envoi"
            type="email"
            value={v.fromEmail || ''}
            derivedValue={derived.fromEmail}
            derivedFrom="l'email de contact de l'Établissement"
            overrideLabel="Utiliser une autre adresse"
            onChange={(val) => onChange('fromEmail', val)}
            error={errors.smtpFromEmail}
            helperText="Adresse affichée comme expéditeur."
            disabled={disabled}
          />

          <DerivedValueField
            label="Identifiant SMTP"
            value={v.username || ''}
            derivedValue={derived.username}
            derivedFrom="l'adresse d'envoi"
            overrideLabel="Identifiant différent"
            onChange={(val) => onChange('username', val)}
            disabled={disabled}
          />

          <MaskedTextField
            label="Mot de passe SMTP"
            hasValue={Boolean(v.passwordSet)}
            value={v.passwordDraft}
            onChange={onChangePassword}
            helperText="Pour Gmail, utilisez un mot de passe d'application."
          />

          <DerivedValueField
            label="Nom affiché"
            value={v.fromName || ''}
            derivedValue={derived.fromName}
            derivedFrom="la raison sociale"
            overrideLabel="Autre nom"
            onChange={(val) => onChange('fromName', val)}
            error={errors.smtpFromName}
            helperText="Nom affiché aux destinataires."
            disabled={disabled}
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
