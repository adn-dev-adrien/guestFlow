/**
 * SettingsWeatherSection — "Alertes météo" card in /parametres.
 *
 * Configures the Météo-France Vigilance API key used to surface Orange/Red weather alerts on the
 * arrival check-in SAS (specs/checkin-weather-alerts.md). The key uses MaskedTextField — the
 * cleartext only leaves the UI on save, and the server never returns it (only `apiKeySet: boolean`).
 *
 * Props:
 *   values:   { apiKeySet: boolean, apiKeyDraft?: string | undefined }
 *             apiKeyDraft semantics (mirrors SMTP passwordDraft):
 *               undefined → preserve the existing value on save
 *               ''        → explicit clear
 *               'value'   → store
 *   onChangeApiKey: (value: string | undefined) => void   — apiKeyDraft setter
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, Box, Link } from '@mui/material';
import MaskedTextField from './MaskedTextField';

export default function SettingsWeatherSection({ values, onChangeApiKey }) {
  const v = values || {};

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">
              Alertes météo
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Affiche une page d'alerte dans le check-in du client quand une vigilance Météo-France
              Orange ou Rouge (canicule, orages…) touche le domaine pendant son séjour. L'adresse
              utilisée est celle des « Informations sur votre activité ».
            </Typography>
          </Box>

          <MaskedTextField
            label="Clé API Météo-France (Vigilance)"
            hasValue={Boolean(v.apiKeySet)}
            value={v.apiKeyDraft}
            onChange={onChangeApiKey}
            helperText={(
              <>
                Clé gratuite à créer sur le{' '}
                <Link href="https://portail-api.meteofrance.fr/" target="_blank" rel="noopener noreferrer">
                  portail API Météo-France
                </Link>{' '}
                (application « Données Vigilance / DPVigilance »). Sans clé, la fonction reste inactive.
              </>
            )}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
