/**
 * LinenStockPage — `/parametres/stock-blanchisserie`
 * (specs/linen-inventory-shortage-tracking.md §6.1).
 *
 * Standalone page with 6 number fields (bed simple/double/baby + towel large/medium/small).
 * 0 = "I don't track this type" — the simulation skips it and the UI hides any line for that
 * type elsewhere (Planning + Dashboard).
 *
 * Persists to `app_settings.bedLinenStock*` / `towelStock*` via `PUT /api/settings { linenStock: {...} }`.
 * Uses the same dirty-form guard pattern as the rest of SettingsPage so navigation away with
 * unsaved changes prompts a confirmation.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, Stack, Typography, TextField, FormHelperText, Alert } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import BathtubIcon from '@mui/icons-material/Bathtub';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';

const EMPTY = { bedSingle: 0, bedDouble: 0, bedBaby: 0, towelLarge: 0, towelMedium: 0, towelSmall: 0 };

function clampInt(value) {
  const n = Math.floor(Number(value) || 0);
  if (n < 0) return 0;
  if (n > 999) return 999;
  return n;
}

export default function LinenStockPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedForm, setSavedForm] = useState(EMPTY);
  const [draft, setDraft] = useState(EMPTY);
  const [snackbar, setSnackbar] = useState(null);

  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft, saved: savedForm, navigate,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getSettings();
        if (!mounted) return;
        const linenStock = (data && data.linenStock) || EMPTY;
        const shaped = { ...EMPTY, ...linenStock };
        setSavedForm(shaped);
        setDraft(shaped);
      } catch (err) {
        if (mounted) setSnackbar({ severity: 'error', message: err.message || 'Impossible de charger le stock.' });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const update = (key) => (e) => setDraft((d) => ({ ...d, [key]: clampInt(e.target.value) }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ linenStock: draft });
      setSavedForm(draft);
      setSnackbar({ severity: 'success', message: 'Stock enregistré.' });
    } catch (err) {
      setSnackbar({ severity: 'error', message: err.message || 'Échec de l\'enregistrement.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => setDraft(savedForm);

  return (
    <Box>
      <PageActionBar
        title="Stock blanchisserie"
        backTo="/parametres"
        onSave={handleSave}
        saveDisabled={loading || saving || !isDirty}
        saveBusy={saving}
        onCancel={handleCancel}
        cancelDisabled={loading || saving || !isDirty}
      />
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900 }}>
        {snackbar && (
          <Alert severity={snackbar.severity} sx={{ mb: 2 }} onClose={() => setSnackbar(null)}>
            {snackbar.message}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Indiquez combien de jeux complets de chaque type vous possédez. Le total est partagé
          entre tous les logements. Les valeurs sont utilisées pour projeter la disponibilité de
          votre stock jour par jour et alerter en cas de rupture prévue.
        </Typography>

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HotelIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Parures de lit
                </Typography>
              </Box>
              <FormHelperText>Indiquez 0 si vous ne souhaitez pas suivre ce type.</FormHelperText>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Simples"
                  type="number"
                  size="small"
                  value={draft.bedSingle}
                  onChange={update('bedSingle')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Doubles"
                  type="number"
                  size="small"
                  value={draft.bedDouble}
                  onChange={update('bedDouble')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Bébé"
                  type="number"
                  size="small"
                  value={draft.bedBaby}
                  onChange={update('bedBaby')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BathtubIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Serviettes
                </Typography>
              </Box>
              <FormHelperText>Indiquez 0 si vous ne souhaitez pas suivre ce type.</FormHelperText>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Grandes"
                  type="number"
                  size="small"
                  value={draft.towelLarge}
                  onChange={update('towelLarge')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Moyennes"
                  type="number"
                  size="small"
                  value={draft.towelMedium}
                  onChange={update('towelMedium')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
                <TextField
                  label="Petites"
                  type="number"
                  size="small"
                  value={draft.towelSmall}
                  onChange={update('towelSmall')}
                  disabled={loading || saving}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0, max: 999, step: 1 }
                  }}
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}
