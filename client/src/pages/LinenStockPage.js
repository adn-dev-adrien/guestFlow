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
import { Box, Card, CardContent, Stack, Typography, TextField, FormHelperText, Alert, Button, IconButton, Divider } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import BathtubIcon from '@mui/icons-material/Bathtub';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
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
  // Priced linen items for the SAS (specs/arrival-departure-sas.md §3.4). Managed independently
  // from the stock counts, with its own save action.
  const [items, setItems] = useState([]);
  const [savingItems, setSavingItems] = useState(false);

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
        try { setItems(await api.getLinenItems()); } catch { /* table may be empty */ }
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

  const addItem = (category) => setItems((list) => [...list, { label: '', price: 0, category }]);
  const updateItem = (idx, field, value) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  const removeItem = (idx) => setItems((list) => list.filter((_, i) => i !== idx));
  const saveItems = async () => {
    setSavingItems(true);
    try {
      const payload = items
        .filter((it) => String(it.label || '').trim())
        .map((it) => ({ label: String(it.label).trim(), price: Math.max(0, Number(it.price) || 0), category: it.category === 'towel' ? 'towel' : 'bed' }));
      setItems(await api.updateLinenItems(payload));
      setSnackbar({ severity: 'success', message: 'Tarifs enregistrés.' });
    } catch (err) {
      setSnackbar({ severity: 'error', message: err.message || 'Échec de l\'enregistrement des tarifs.' });
    } finally {
      setSavingItems(false);
    }
  };

  const renderItemsSection = (category, label) => {
    const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => (it.category === 'towel' ? 'towel' : 'bed') === category);
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{label}</Typography>
        {rows.length === 0 && <Typography variant="caption" color="text.secondary">Aucun élément. Ajoutez-en avec le bouton ci-dessous.</Typography>}
        {rows.map(({ it, i }) => (
          <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField label="Libellé" size="small" value={it.label} onChange={(e) => updateItem(i, 'label', e.target.value)} sx={{ flex: 1 }} />
            <TextField label="Prix (€)" size="small" type="number" value={it.price} onChange={(e) => updateItem(i, 'price', e.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 0, step: 0.5 } }} />
            <IconButton aria-label="Supprimer" color="error" onClick={() => removeItem(i)}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
        <Button startIcon={<AddIcon />} size="small" onClick={() => addItem(category)} sx={{ alignSelf: 'flex-start' }}>Ajouter</Button>
      </Stack>
    );
  };

  return (
    <Box>
      <PageActionBar
        title="Blanchisserie"
        backTo="/parametres"
        onSave={handleSave}
        saveDisabled={loading || saving || !isDirty}
        saveBusy={saving}
        onCancel={handleCancel}
        cancelDisabled={loading || saving || !isDirty}
      />
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: '100%', md: 900, lg: 1240 }, mx: 'auto' }}>
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

        {/* Two small cards side-by-side on lg+ (masonry), stacked on smaller screens. */}
        <Box sx={{ columnGap: { lg: 3 }, columnCount: { xs: 1, lg: 2 } }}>
          <Box sx={{ breakInside: 'avoid' }}>
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
          </Box>

          <Box sx={{ breakInside: 'avoid' }}>
            <Card variant="outlined" sx={{ mb: 3 }}>
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
        </Box>

        {/* Priced linen items used by the arrival/departure SAS (specs/arrival-departure-sas.md §3.4). */}
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2.5}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocalLaundryServiceIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Tarifs des éléments (SAS arrivée / départ)</Typography>
              </Box>
              <FormHelperText>
                Tarifs proposés dans le SAS pour facturer un élément manquant. Les éléments de lit
                servent au SAS d'arrivée ; les deux catégories au SAS de départ.
              </FormHelperText>
              {renderItemsSection('bed', 'Éléments de linge de lit')}
              <Divider />
              {renderItemsSection('towel', 'Serviettes')}
              <Box>
                <Button variant="contained" onClick={saveItems} disabled={savingItems}>
                  Enregistrer les tarifs
                </Button>
              </Box>
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
