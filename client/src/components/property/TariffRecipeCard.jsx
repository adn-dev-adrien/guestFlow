/**
 * TariffRecipeCard — the property's active tariff recipe on its tarif page
 * (specs/tariff-recipes/spec.md §3.2 rules 7-8, §3.5 rule 29).
 *
 * Shows the active recipe + the applied version, warns when the recipe file has moved on, lets the
 * operator pick a recipe and APPLY it — always through the preview dialog: the server-computed diff
 * (seasons created / updated / removed, ranges added and dropped, closures, warnings) is shown and
 * nothing is written until « Appliquer ». A vanished recipe offers a detach.
 *
 * Props:
 *   propertyId       — number, required.
 *   activeRecipeId   — string ('' = manual).
 *   appliedVersion   — string.
 *   onApplied        — () => void  (reload seasons after an apply / detach).
 *   onError          — optional (message: string) => void.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, CardContent, Box, Typography, Chip, Button, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, List, ListItem, ListItemText,
  useMediaQuery, useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import api from '../../api';
import LoadingState from '../LoadingState';

const ACTION_LABELS = {
  create: { label: 'sera créée', color: 'success' },
  update: { label: 'sera modifiée', color: 'info' },
  remove: { label: 'sera supprimée', color: 'error' },
  unchanged: { label: 'inchangée', color: 'default' },
};

function frRange(range) {
  const fr = (iso) => iso.split('-').reverse().join('/');
  const extras = [];
  if (range.minNights != null) extras.push(`min ${range.minNights} nuits`);
  return `${fr(range.startDate)} → ${fr(range.endDate)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export default function TariffRecipeCard({ propertyId, activeRecipeId, appliedVersion, onApplied, onError }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [recipes, setRecipes] = useState(null);
  const [selectedId, setSelectedId] = useState(activeRecipeId || '');
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelectedId(activeRecipeId || ''); }, [activeRecipeId]);

  const load = useCallback(async () => {
    try {
      const res = await api.getTariffRecipes();
      setRecipes(res?.recipes || []);
    } catch { setRecipes([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const activeRecipe = useMemo(
    () => (recipes || []).find((r) => r.id === activeRecipeId) || null,
    [recipes, activeRecipeId]
  );
  const recipeVanished = Boolean(activeRecipeId) && recipes !== null && !activeRecipe;
  const newerVersion = activeRecipe && appliedVersion && activeRecipe.version !== appliedVersion
    ? activeRecipe.version : null;

  const openPreview = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      setPreview(await api.previewTariffRecipe(propertyId, selectedId));
      setPreviewOpen(true);
    } catch (err) {
      if (onError) onError(err.message || 'Aperçu impossible.');
    } finally { setBusy(false); }
  };

  const applyRecipe = async () => {
    setBusy(true);
    try {
      await api.applyTariffRecipe(propertyId, selectedId);
      setPreviewOpen(false);
      setPreview(null);
      if (onApplied) onApplied();
    } catch (err) {
      if (onError) onError(err.message || "Impossible d'appliquer la recette.");
    } finally { setBusy(false); }
  };

  const detach = async () => {
    setBusy(true);
    try {
      await api.detachTariffRecipe(propertyId);
      if (onApplied) onApplied();
    } catch (err) {
      if (onError) onError(err.message || 'Impossible de détacher la recette.');
    } finally { setBusy(false); }
  };

  const changedSeasons = (preview?.seasons || []).filter((s) => s.action !== 'unchanged');

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AutoAwesomeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="sectionHeader">Recette tarifaire</Typography>
          {activeRecipeId && !recipeVanished && (
            <Chip size="small" color="success" variant="outlined" label={`v${appliedVersion || '?'} appliquée`} />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Les saisons sont calculées à partir du calendrier — jours fériés compris. Appliquer une
          recette remplace les saisons qu'elle gère ; les saisons manuelles ne sont jamais touchées.
        </Typography>

        {recipes === null && <LoadingState py={1} label="Chargement…" />}

        {recipeVanished && (
          <Alert
            severity="warning" sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" onClick={detach} disabled={busy}>Détacher</Button>}
          >
            Recette introuvable ({activeRecipeId}) — les saisons restent en l'état, mais le calendrier
            ne sera plus étendu.
          </Alert>
        )}
        {newerVersion && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Version {newerVersion} disponible (v{appliedVersion} appliquée) — relancer « Appliquer »
            pour la prendre en compte.
          </Alert>
        )}

        {recipes !== null && (
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' } }}>
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 320 } }}>
              <InputLabel id="tariff-recipe-select-label">Recette</InputLabel>
              <Select
                labelId="tariff-recipe-select-label"
                label="Recette"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <MenuItem value="">Aucune (saisons manuelles)</MenuItem>
                {recipes.map((r) => (
                  <MenuItem key={r.id} value={r.id}>{r.label} — v{r.version}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedId ? (
              <Button variant="contained" onClick={openPreview} disabled={busy} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                Appliquer la recette…
              </Button>
            ) : (activeRecipeId && !recipeVanished && (
              <Button variant="outlined" color="warning" onClick={detach} disabled={busy} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                Détacher la recette
              </Button>
            ))}
          </Box>
        )}
      </CardContent>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth fullScreen={fullScreen}>
        <DialogTitle>Aperçu des modifications</DialogTitle>
        <DialogContent dividers>
          {preview && (
            <>
              {preview.horizon && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {preview.recipe.label} — v{preview.recipe.version} · horizon {preview.horizon.fromYear} → {preview.horizon.toYear}
                </Typography>
              )}
              {(preview.warnings || []).map((warning, index) => (
                <Alert key={index} severity={preview.blocking ? 'error' : 'warning'} sx={{ mb: 1 }}>{warning}</Alert>
              ))}
              {changedSeasons.length === 0 && (preview.closures?.added || []).length === 0 && !preview.blocking && (
                <Alert severity="success">Rien à modifier — les saisons sont déjà conformes à la recette.</Alert>
              )}
              <List dense disablePadding>
                {(preview.seasons || []).filter((s) => s.action !== 'unchanged').map((season) => (
                  <ListItem key={season.seasonKey} alignItems="flex-start" disableGutters
                    sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1, mb: 1, display: 'block' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2">{season.label}</Typography>
                      <Chip size="small" variant="outlined"
                        color={ACTION_LABELS[season.action]?.color || 'default'}
                        label={ACTION_LABELS[season.action]?.label || season.action} />
                      {/* spec §3.2 rule 9bis — a hand-painted season taken over by the recipe. */}
                      {season.adopted && (
                        <Chip size="small" variant="outlined" color="warning" label="saison manuelle adoptée" />
                      )}
                    </Box>
                    {(season.fieldChanges || []).length > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {season.fieldChanges.map((c) => `${c.field} : ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ')}
                      </Typography>
                    )}
                    {(season.rangesAdded || []).map((range) => (
                      <Typography key={`a-${range.startDate}`} variant="caption" sx={{ display: 'block', color: 'success.main' }}>
                        + {frRange(range)}
                      </Typography>
                    ))}
                    {(season.rangesRemoved || []).map((range) => (
                      <Typography key={`r-${range.startDate}`} variant="caption" sx={{ display: 'block', color: 'error.main', textDecoration: 'line-through' }}>
                        − {frRange(range)}
                      </Typography>
                    ))}
                  </ListItem>
                ))}
                {(preview.closures?.added || []).length > 0 && (
                  <ListItem disableGutters sx={{ display: 'block' }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Fermetures</Typography>
                    {preview.closures.added.map((closure) => (
                      <Typography key={closure.startDate} variant="caption" sx={{ display: 'block', color: 'success.main' }}>
                        + {closure.label} : {frRange(closure)}
                      </Typography>
                    ))}
                  </ListItem>
                )}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={applyRecipe} disabled={busy || !preview || preview.blocking}>
            Appliquer
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
