/**
 * SettingsNotificationsSection — "Notifications de réservation" card.
 *
 * Master switch + recipient address for the booking notification emails
 * (specs/site-booking-notifications.md §6). When ON (default), GuestFlow emails the operator on a
 * new website devis and on a new iCal reservation. Emails are sent FROM the SMTP sender; an empty
 * recipient falls back to that sender. The link in the email reuses the SMTP "URL publique".
 *
 * Persisted in app_settings.notificationsEnabled (0/1) + notificationRecipientEmail.
 * Mirrors the visual shape of the other Settings sections (Card → Stack → h6 → caption).
 *
 * Props:
 *   values:   { enabled: boolean, icalReservationEnabled: boolean, recipientEmail: string }
 *   errors:   { notificationRecipientEmail?: string }
 *   onChange: (key, value) => void
 *   disabled: boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, FormControlLabel, Switch, Box, TextField,
} from '@mui/material';

export default function SettingsNotificationsSection({
  values = { enabled: true, icalReservationEnabled: true, recipientEmail: '' },
  errors = {},
  onChange,
  disabled = false,
}) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">
              Notifications de réservation
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Recevez un email à chaque nouvelle demande de devis depuis le site et à chaque nouvelle
              réservation importée (iCal). Les emails sont envoyés depuis l'adresse expéditrice SMTP.
            </Typography>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(values.enabled)}
                onChange={(e) => onChange('enabled', e.target.checked)}
                disabled={disabled}
              />
            }
            label="Activer les notifications par email"
            sx={{ alignSelf: 'flex-start' }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(values.icalReservationEnabled)}
                onChange={(e) => onChange('icalReservationEnabled', e.target.checked)}
                disabled={disabled || !values.enabled}
              />
            }
            label="Email à chaque nouvelle réservation plateforme (iCal)"
            sx={{ alignSelf: 'flex-start' }}
          />

          <TextField
            label="Adresse de réception des notifications"
            type="email"
            value={values.recipientEmail || ''}
            onChange={(e) => onChange('recipientEmail', e.target.value)}
            disabled={disabled || !values.enabled}
            error={Boolean(errors.notificationRecipientEmail)}
            helperText={
              errors.notificationRecipientEmail
              || "Si vide, l'adresse expéditrice SMTP est utilisée."
            }
            fullWidth
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
