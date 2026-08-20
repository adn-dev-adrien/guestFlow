/**
 * SettingsEmailAutomationSection — "Envoi automatique des emails" card.
 *
 * The master switch guarding every email GuestFlow would send to a guest with nobody in the loop:
 * the 08:00 template cron, and the confirmation fired by a confirmed online payment
 * (specs/no-automatic-email-without-approval.md §6). OFF by default — those emails are then only
 * PROPOSED, in the « Emails à envoyer » review list, and leave on the operator's click.
 *
 * Out of its reach, and said so in the card: the notifications GuestFlow sends to the operator
 * (their own switch, just above) and account emails such as "mot de passe oublié".
 *
 * Persisted in app_settings.emailAutoSendEnabled (0/1).
 * Mirrors the visual shape of the other Settings sections (Card → Stack → h6 → caption).
 *
 * Props:
 *   values:   { autoSendEnabled: boolean }
 *   onChange: (key, value) => void
 *   disabled: boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, FormControlLabel, Switch, Box, Alert,
} from '@mui/material';

export default function SettingsEmailAutomationSection({
  values = { autoSendEnabled: false },
  onChange,
  disabled = false,
}) {
  const enabled = Boolean(values.autoSendEnabled);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">
              Envoi automatique des emails
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Par défaut, GuestFlow ne fait que <strong>proposer</strong> les emails destinés aux
              clients : ils attendent votre validation dans « Emails à envoyer ». Vos notifications
              de réservation et les emails de compte (mot de passe oublié) ne sont pas concernés.
            </Typography>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => onChange('autoSendEnabled', e.target.checked)}
                disabled={disabled}
              />
            }
            label="Autoriser GuestFlow à envoyer les emails sans validation"
            sx={{ alignSelf: 'flex-start' }}
          />

          {enabled ? (
            <Alert severity="warning" variant="outlined">
              Les modèles en mode « Automatique » partent seuls à 08:00, et la confirmation de
              réservation part dès qu'un paiement en ligne est confirmé.
            </Alert>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
