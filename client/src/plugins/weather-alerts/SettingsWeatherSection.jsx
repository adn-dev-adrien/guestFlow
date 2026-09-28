/**
 * SettingsWeatherSection — the « Alertes météo » card of Paramètres › Intégrations
 * (specs/checkin-weather-alerts.md; specs/plugins-phase-1-sdk.md rule 7).
 *
 * Configures the Météo-France Vigilance API key used to surface Orange/Red weather alerts on the
 * arrival check-in SAS. The key lives in the plugin's own settings (`GET/PUT
 * /api/plugins/weather-alerts/settings`); the server never returns it, only `apiKeySet`.
 *
 * Like the Neat card, it has no Save of its own: the page's bar saves it through the ref.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void   fired when the card gains or loses unsaved changes
 * Ref:
 *   save()   writes the draft (undefined → keep, '' → clear, 'value' → store)
 *   reset()  drops the draft
 */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Card, CardContent, Stack, Typography, Box, Link } from '@mui/material';
import { api, MaskedTextField } from '../sdk';

const PLUGIN = 'weather-alerts';

function SettingsWeatherSection({ onDirtyChange }, ref) {
  const [apiKeySet, setApiKeySet] = useState(false);
  const [draft, setDraft] = useState(undefined);
  const dirty = draft !== undefined;

  useEffect(() => {
    let mounted = true;
    api.getPluginSettings(PLUGIN)
      .then((s) => { if (mounted) setApiKeySet(Boolean(s && s.apiKeySet)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    async save() {
      if (!dirty) return;
      const saved = await api.savePluginSettings(PLUGIN, { apiKey: draft === '' ? null : draft });
      setApiKeySet(Boolean(saved && saved.apiKeySet));
      setDraft(undefined);
    },
    reset: () => setDraft(undefined),
  }));

  const v = { apiKeySet, apiKeyDraft: draft };
  const onChangeApiKey = setDraft;

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

export default forwardRef(SettingsWeatherSection);
