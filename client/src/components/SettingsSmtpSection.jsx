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
 * On a hosted instance (specs/hosting-h1-fleet-runtime.md rule 19) the card opens on « Envoi par la
 * plateforme » — the server's `platform` block — and the SMTP fields fold behind « Utiliser mon
 * propre serveur ». A saved host always wins: the card then says « Serveur personnel », unfolded.
 *
 * specs/settings-rationalization.md rule 28 (UI/UX review 2026-10-18, decision 14): the operator
 * types the address and the password; the server found from the address (`detection`) is said under
 * the password, and the server writes it at save. The server field, the login and the security fold
 * behind « Réglages avancés », opened when no provider was found. The test button says what it lacks.
 *
 * Props:
 *   values:      { host, secure, username, passwordSet, fromEmail, fromName,
 *                  derived: { fromEmail, username, fromName }, passwordDraft?: string | undefined,
 *                  platform?: { available, active, replyTo } }
 *                passwordDraft: undefined → preserve, '' → clear, 'value' → store
 *   errors:      { smtpHost?, smtpFromEmail?, smtpFromName? } (server-side validation)
 *   onChange:    (key, value) => void
 *   onChangePassword: (value: string | undefined) => void
 *   onSendTest:  () => Promise          — triggers POST /api/settings/smtp-test
 *   testing:     boolean                — spinner on the test button
 *   testResult:  { severity, message, onClose } | null
 *   disabled:    boolean
 *   detection:   { status: 'idle'|'loading'|'found'|'missing', provider: { name, host, hint } | null,
 *                  message } — useSmtpDetection
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, TextField, Box, Button, MenuItem, Alert, CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MaskedTextField from './MaskedTextField';
import DerivedValueField from './DerivedValueField';
import StatusBadge from './StatusBadge';
import CollapsibleSection from './CollapsibleSection';
import AdvancedDetails from './AdvancedDetails';

export default function SettingsSmtpSection({
  values,
  errors = {},
  onChange,
  onChangePassword,
  onSendTest,
  testing = false,
  testResult,
  disabled = false,
  detection = { status: 'idle', provider: null, message: '' },
}) {
  const v = values || {};
  const derived = v.derived || {};
  const setEvt = (k) => (e) => onChange(k, e.target.value);

  // « Envoyer un mail de test » needs a host, a sending address (override or derived) and a
  // password — saved (passwordSet) or typed in the draft.
  const hasPassword = v.passwordSet || (v.passwordDraft && v.passwordDraft.trim() !== '');
  const sendingAddress = String(v.fromEmail || '').trim() || String(derived.fromEmail || '').trim();
  const hostTyped = String(v.host || '').trim() !== '';
  const canTest = !disabled && !testing && hostTyped && sendingAddress !== '' && hasPassword;
  // What the disabled test button waits for, said next to it.
  let testMissing = null;
  if (!sendingAddress) testMissing = 'Adresse d’envoi manquante.';
  else if (!hasPassword) testMissing = 'Mot de passe manquant.';
  else if (!hostTyped) testMissing = detection.status === 'found' ? 'À enregistrer d’abord.' : 'Serveur d’envoi manquant.';
  const found = !hostTyped && detection.status === 'found' && detection.provider;
  const notFound = !hostTyped && detection.status === 'missing';
  let serverLine = null;
  if (hostTyped) serverLine = `Serveur d’envoi : ${String(v.host).trim()}.`;
  else if (detection.status === 'loading') serverLine = 'Recherche du serveur d’envoi…';
  else if (found) serverLine = `${detection.message} Retenu à l’enregistrement.`;
  else if (notFound) serverLine = detection.message;

  const platform = v.platform || { available: false, active: false, replyTo: '' };
  const smtpFields = (
    <>
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

      <MaskedTextField
        label="Mot de passe de l’adresse d’envoi"
        hasValue={Boolean(v.passwordSet)}
        value={v.passwordDraft}
        onChange={onChangePassword}
        helperText={(found && detection.provider.hint) || 'Le mot de passe de la boîte mail ; pour Gmail, un mot de passe d’application.'}
      />

      {serverLine && (
        <Typography variant="body2" role="status" color={notFound ? 'warning.main' : 'text.secondary'} sx={{ mt: -1 }}>
          {serverLine}
        </Typography>
      )}

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

      {/* specs/plugins-phase-p-productisation.md rule 41 — the protocol names stay under « Avancé ». */}
      <AdvancedDetails label="Réglages avancés" defaultOpen={notFound} key={notFound ? 'open' : 'folded'}>
        <Stack spacing={2}>
          <TextField
            label="Serveur d’envoi"
            value={v.host || ''}
            onChange={setEvt('host')}
            disabled={disabled}
            error={Boolean(errors.smtpHost)}
            helperText={errors.smtpHost || (found ? `Vide : ${detection.provider.host}, trouvé depuis l’adresse.` : 'Exemple : smtp.gmail.com')}
            placeholder={found ? detection.provider.host : undefined}
            fullWidth
            size="small"
          />
          <DerivedValueField
            label="Identifiant du serveur"
            value={v.username || ''}
            derivedValue={derived.username}
            derivedFrom="l'adresse d'envoi"
            overrideLabel="Identifiant différent"
            onChange={(val) => onChange('username', val)}
            disabled={disabled}
          />
          <TextField
            label="Sécurité de la connexion"
            select
            value={v.secure ? 1 : 0}
            onChange={(e) => onChange('secure', Number(e.target.value) === 1)}
            disabled={disabled}
            size="small"
            fullWidth
            helperText={found
              ? `Celle du serveur trouvé : ${detection.provider.secure ? 'TLS implicite, port 465' : 'STARTTLS, port 587'}.`
              : `Port utilisé : ${v.secure ? 465 : 587} (déduit).`}
          >
            <MenuItem value={0}>STARTTLS</MenuItem>
            <MenuItem value={1}>TLS implicite</MenuItem>
          </TextField>
        </Stack>
      </AdvancedDetails>

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
          {canTest || !testMissing ? 'Envoi d’un « Email de test GuestFlow » à l’adresse du compte connecté.' : testMissing}
        </Typography>
        {testResult && (
          <Alert severity={testResult.severity} onClose={testResult.onClose}>
            {testResult.message}
          </Alert>
        )}
      </Box>
    </>
  );

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="sectionHeader">Envoi</Typography>
            {platform.available && (
              <StatusBadge
                status={platform.active ? 'success' : 'info'}
                label={platform.active ? 'Envoi par la plateforme' : 'Serveur personnel'}
              />
            )}
          </Box>
          {platform.available ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
                {platform.active
                  ? `Les réponses arrivent à ${platform.replyTo || 'l’email de contact de l’Établissement'}.`
                  : 'Ce serveur passe devant l’envoi par la plateforme.'}
              </Typography>
              <CollapsibleSection
                title="Utiliser mon propre serveur"
                defaultExpanded={!platform.active}
                toggleLabel="Afficher"
              >
                <Stack spacing={2} sx={{ pt: 1 }}>
                  {smtpFields}
                </Stack>
              </CollapsibleSection>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
                Le serveur qui envoie les emails de GuestFlow.
              </Typography>
              {smtpFields}
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
