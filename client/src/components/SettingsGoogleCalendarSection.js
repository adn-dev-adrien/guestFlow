/**
 * SettingsGoogleCalendarSection — "Synchronisation Google Agenda" card.
 *
 * Composes 2 HelpedTextField + 1 MaskedTextField + a status chip + a "Tester
 * la synchronisation" button + an inline Alert with the last test result.
 *
 * Props:
 *   values:           { calendarId, serviceAccountEmail, privateKeyMasked, configured, privateKeyDraft }
 *                       privateKeyDraft: undefined = "untouched" (preserve server value)
 *                                        ''        = "clear"
 *                                        '...'     = "store this new key"
 *   errors:           { googleCalendarId?, googleServiceAccountEmail?, googleServiceAccountPrivateKey? }
 *   statusLabel:      string from server (or overridden by an error testResult)
 *   onChange:         (key, value) => void    — for calendarId, serviceAccountEmail
 *   onChangePrivateKey: (value | undefined) => void
 *   onTest:           () => void
 *   testing:          boolean
 *   testResult:       { severity: 'success'|'error', message } | null
 *   disabled:         boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, Box, Button, Alert, Chip, CircularProgress,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import HelpedTextField from './HelpedTextField';
import MaskedTextField from './MaskedTextField';

const STATUS_TO_CHIP = {
  'Synchronisation active': { color: 'success' },
  'Configuration en cours': { color: 'warning' },
  'Synchronisation non configurée': { color: 'default' },
  'Échec de la dernière synchro': { color: 'error' },
};

const HELP_URLS = {
  calendarId: 'https://support.google.com/calendar/answer/37083?hl=fr',
  serviceAccountEmail: 'https://cloud.google.com/iam/docs/service-account-overview?hl=fr',
  privateKey: 'https://cloud.google.com/iam/docs/keys-create-delete?hl=fr',
};

function deriveChip(statusLabel, testResult) {
  const label = testResult && testResult.severity === 'error'
    ? 'Échec de la dernière synchro'
    : statusLabel;
  const meta = STATUS_TO_CHIP[label] || { color: 'default' };
  return { color: meta.color, label };
}

export default function SettingsGoogleCalendarSection({
  values,
  errors = {},
  statusLabel,
  onChange,
  onChangePrivateKey,
  onTest,
  testing = false,
  testResult,
  disabled = false,
}) {
  const v = values || {};
  const chip = deriveChip(statusLabel, testResult);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 1,
            }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Synchronisation Google Agenda
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Vos réservations seront automatiquement copiées dans votre Google Agenda.
              </Typography>
            </Box>
            <Chip size="small" color={chip.color} label={chip.label} sx={{ fontWeight: 600 }} />
          </Box>

          <HelpedTextField
            label="Identifiant de votre Google Agenda"
            value={v.calendarId || ''}
            onChange={(val) => onChange('calendarId', val)}
            helperText="Trouvez-le dans Google Agenda > Paramètres > Intégrer le calendrier."
            helpLink={{ href: HELP_URLS.calendarId, label: "Voir l'aide Google" }}
            error={errors.googleCalendarId}
            disabled={disabled}
          />

          <HelpedTextField
            label="Adresse du compte technique Google"
            value={v.serviceAccountEmail || ''}
            onChange={(val) => onChange('serviceAccountEmail', val)}
            helperText="Adresse robot créée dans Google Cloud Console."
            helpLink={{ href: HELP_URLS.serviceAccountEmail, label: "Voir l'aide Google" }}
            error={errors.googleServiceAccountEmail}
            disabled={disabled}
          />

          <MaskedTextField
            label="Clé d'authentification"
            hasValue={Boolean(v.privateKeyMasked)}
            value={v.privateKeyDraft}
            onChange={onChangePrivateKey}
            helperText='Collez la valeur du champ "private_key" du fichier JSON téléchargé.'
            error={errors.googleServiceAccountPrivateKey}
            multiline
            minRows={6}
          />

          <Box>
            <Button
              variant="contained"
              onClick={onTest}
              disabled={!v.configured || testing || disabled}
              startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              {testing ? 'Test en cours…' : 'Tester la synchronisation'}
            </Button>
          </Box>

          {testResult && (
            <Alert severity={testResult.severity}>{testResult.message}</Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
