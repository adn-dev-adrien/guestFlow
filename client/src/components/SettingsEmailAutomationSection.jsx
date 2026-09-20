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
 * Also carries the settings of the guest email sequence (specs/guest-email-sequence.md §6.2): the
 * day it started (read-only, set by the server on first activation), the review and Instagram links
 * the J+1 email quotes, and the pool season the emails mention.
 *
 * Props:
 *   values:   { autoSendEnabled, sequenceStartDate, googleReviewUrl, instagramUrl, poolSeasonStart, poolSeasonEnd }
 *   onChange: (key, value) => void
 *   disabled: boolean
 *   errors:   { [column]: string } — server validation messages
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, FormControlLabel, Switch, Box, Alert, TextField,
} from '@mui/material';
import HelpedTextField from './HelpedTextField';
import { displayDate } from '../utils/formatters';

export default function SettingsEmailAutomationSection({
  values = { autoSendEnabled: false },
  onChange,
  disabled = false,
  errors = {},
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

          <Box>
            <Typography variant="subtitle2">Séquence de mails clients</Typography>
            <Typography variant="body2" color="text.secondary">
              {values.sequenceStartDate
                ? `Active depuis le ${displayDate(values.sequenceStartDate)} : seuls les séjours à venir à cette date la reçoivent, jamais les séjours passés.`
                : 'Pas encore activée : elle démarrera le jour où l\'envoi automatique sera autorisé, pour les séjours à venir uniquement. L\'onglet Simulation de l\'historique des emails montre ce qui partirait.'}
            </Typography>
          </Box>

          <HelpedTextField
            label="Lien d'avis Google"
            value={values.googleReviewUrl || ''}
            onChange={(v) => onChange('googleReviewUrl', v)}
            helperText="Proposé dans le mail de remerciement (J+1)."
            error={errors.googleReviewUrl}
            disabled={disabled}
          />
          <HelpedTextField
            label="Lien Instagram"
            value={values.instagramUrl || ''}
            onChange={(v) => onChange('instagramUrl', v)}
            helperText="« Si vous êtes nostalgiques de votre séjour… » dans le mail J+1."
            error={errors.instagramUrl}
            disabled={disabled}
          />
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              label="Piscine ouverte du (MM-JJ)"
              value={values.poolSeasonStart || ''}
              onChange={(e) => onChange('poolSeasonStart', e.target.value)}
              error={Boolean(errors.poolSeasonStart)}
              helperText={errors.poolSeasonStart || 'ex. 06-15'}
              disabled={disabled}
              fullWidth
            />
            <TextField
              label="au (MM-JJ)"
              value={values.poolSeasonEnd || ''}
              onChange={(e) => onChange('poolSeasonEnd', e.target.value)}
              error={Boolean(errors.poolSeasonEnd)}
              helperText={errors.poolSeasonEnd || 'ex. 08-31'}
              disabled={disabled}
              fullWidth
            />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
