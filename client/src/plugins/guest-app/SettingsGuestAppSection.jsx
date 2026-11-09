/**
 * SettingsGuestAppSection — the « Application clients » card of Paramètres › Intégrations
 * (specs/guest-app.md plan step 5). It sets the address guests reach the app at; the server judges it
 * (`PUT /api/plugins/guest-app/settings`) and its message is shown on the field.
 *
 * Like the other cards with a draft, it has no Save of its own: the page's bar saves it through the ref.
 * « Ouvrir le Studio » opens the booklet studio (`/studio`, rule 47) in a new tab.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void   fired when the card gains or loses unsaved changes
 * Ref:
 *   isDirty(), save(), reset()
 */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
  Box, Button, Card, CardContent, Stack, TextField, Typography,
} from '@mui/material';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { api } from '../sdk';

const PLUGIN = 'guest-app';
const HELP = 'Le nom de domaine que les codes QR des logements ouvriront, par exemple sejour.domainesolio.com. '
  + 'Il doit pointer vers GuestFlow.';

function SettingsGuestAppSection({ onDirtyChange }, ref) {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState(undefined);
  const [error, setError] = useState(null);
  const dirty = draft !== undefined && draft !== saved;

  useEffect(() => {
    let mounted = true;
    api.getPluginSettings(PLUGIN)
      .then((settings) => { if (mounted) setSaved(String((settings && settings.guestHost) || '')); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    async save() {
      if (!dirty) return;
      const value = draft.trim();
      try {
        await api.savePluginSettings(PLUGIN, { guestHost: value });
      } catch (err) {
        setError((err && err.errors && err.errors.guestHost) || null);
        throw err;
      }
      setSaved(value);
      setDraft(undefined);
      setError(null);
    },
    reset: () => {
      setDraft(undefined);
      setError(null);
    },
  }));

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">Application clients</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              L’application « Mon séjour » que vos clients ouvrent avec le code QR de leur logement.
            </Typography>
          </Box>
          <TextField
            label="Adresse de l’application"
            fullWidth
            size="small"
            value={draft === undefined ? saved : draft}
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            error={Boolean(error)}
            helperText={error || HELP}
            slotProps={{ htmlInput: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, inputMode: 'url' } }}
          />
          <Box>
            <Button
              variant="outlined"
              href="/studio"
              target="_blank"
              rel="noopener"
              startIcon={<ArrowOutwardIcon />}
              sx={{ minHeight: 44 }}
            >
              Ouvrir le Studio
            </Button>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
              Le livret, la boutique, les horaires du service et les QR codes des logements.
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default forwardRef(SettingsGuestAppSection);
