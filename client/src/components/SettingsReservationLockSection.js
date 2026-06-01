/**
 * SettingsReservationLockSection — "Réservations passées" card.
 *
 * Admin-only escape hatch for editing reservations whose check-in date has already
 * passed. OFF by default — when OFF, the existing server-side lock holds: only
 * client, platform, prices and payment/caution statuses remain editable on a past
 * reservation, and DELETE returns 403. When ON, both server-side locks are dropped
 * and the matching UI states (banner + grey-out + delete-disabled in ReservationPage)
 * are skipped.
 *
 * Persisted in `app_settings.allowEditPastReservations` (0/1). See
 * specs/admin-unlock-past-reservations.md for the design.
 *
 * Mirrors the visual shape of SettingsVatSection (Card → Stack → h6 → caption) so the
 * page rhythm stays consistent.
 *
 * Props:
 *   value:    boolean    // current toggle state (the draft, not the persisted value)
 *   onChange: (next: boolean) => void
 *   disabled: boolean   // SettingsPage flips this while a save is in flight
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, FormControlLabel, Switch, Box } from '@mui/material';

export default function SettingsReservationLockSection({
  value = false,
  onChange,
  disabled = false,
}) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Réservations passées
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Par défaut, les réservations dont la date d'arrivée est atteinte sont verrouillées :
              seuls le client, la plateforme, les ajustements de prix et les statuts de paiement /
              caution restent modifiables. Activez ce bouton pour permettre la modification
              complète (dates, logement, suppression…) des réservations passées. Pensez à le
              désactiver une fois la correction effectuée.
            </Typography>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(value)}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
              />
            }
            label="Autoriser la modification des réservations passées"
            sx={{ alignSelf: 'flex-start' }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
