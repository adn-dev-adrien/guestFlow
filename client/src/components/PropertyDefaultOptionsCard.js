/**
 * PropertyDefaultOptionsCard — canonical edit surface for per-property option defaults
 * (specs/weekly-bed-linen-tracking.md §3.7).
 *
 * Lists every linen-flagged option (`countsAsBedLinen=1` OR `countsAsBathroomLinen=1`) with two
 * switches per row:
 *   - "Ajouter par défaut" → row exists in `property_option_defaults`.
 *   - "Offert (gratuit)"   → the row's `offered` flag (disabled until the first switch is on).
 *
 * Toggling either switch immediately persists via the API (no Save button). The component owns
 * its loading + busy state per row so the rest of PropertyDetail's dirty-form machinery is
 * untouched — toggling defaults doesn't make the page "dirty".
 *
 * Props:
 *   propertyId — number, required. The property whose defaults are managed.
 *   options    — array of catalog options ({ id, title, countsAsBedLinen, countsAsBathroomLinen }).
 *                Provided by the parent which already loads them.
 *   onError    — optional (err) => void; called when an API call fails so the parent can
 *                surface a snackbar consistent with the rest of the page.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, CardContent, Typography, Box, Stack, Switch, FormControlLabel, CircularProgress,
  Tooltip,
} from '@mui/material';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import api from '../api';

function isLinenOption(option) {
  return Boolean(option && (Number(option.countsAsBedLinen) === 1 || Number(option.countsAsBathroomLinen) === 1));
}

export default function PropertyDefaultOptionsCard({ propertyId, options, onError }) {
  const linenOptions = useMemo(
    () => (options || []).filter(isLinenOption),
    [options]
  );
  // `defaults` is a Map: optionId → { offered }. Absent key ≡ no default.
  const [defaults, setDefaults] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(() => new Set()); // optionIds currently being saved

  const reportError = useCallback((err) => {
    if (typeof onError === 'function') onError(err);
    else console.error('[PropertyDefaultOptionsCard]', err);
  }, [onError]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const rows = await api.getPropertyOptionDefaults(propertyId);
        if (!mounted) return;
        const next = new Map();
        for (const row of (rows || [])) {
          next.set(Number(row.optionId), { offered: Boolean(row.offered) });
        }
        setDefaults(next);
      } catch (err) {
        if (mounted) reportError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [propertyId, reportError]);

  const markBusy = (optionId, on) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(optionId); else next.delete(optionId);
      return next;
    });
  };

  const toggleAddedByDefault = async (optionId, checked) => {
    markBusy(optionId, true);
    try {
      if (checked) {
        // Default offered = false on first toggle ON — operator explicitly enables it after.
        await api.setPropertyOptionDefault(propertyId, optionId, false);
        setDefaults((prev) => new Map(prev).set(Number(optionId), { offered: false }));
      } else {
        await api.unsetPropertyOptionDefault(propertyId, optionId);
        setDefaults((prev) => { const next = new Map(prev); next.delete(Number(optionId)); return next; });
      }
    } catch (err) {
      reportError(err);
    } finally {
      markBusy(optionId, false);
    }
  };

  const toggleOffered = async (optionId, checked) => {
    markBusy(optionId, true);
    try {
      await api.setPropertyOptionDefault(propertyId, optionId, checked);
      setDefaults((prev) => new Map(prev).set(Number(optionId), { offered: checked }));
    } catch (err) {
      reportError(err);
    } finally {
      markBusy(optionId, false);
    }
  };

  if (linenOptions.length === 0) {
    // No linen options exist yet (fresh install before seeds run) → silent. Nothing to show.
    return null;
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LocalLaundryServiceIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="h6">Options ajoutées par défaut</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sélectionnez les options qui seront pré-cochées sur chaque <strong>nouvelle</strong>{' '}
          réservation pour ce logement. Activez « Offert » quand l'option est incluse dans le
          tarif (gratuite pour le client). Les modifications sont sauvegardées immédiatement.
        </Typography>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Chargement…</Typography>
          </Box>
        )}

        {!loading && (
          <Stack spacing={1.25}>
            {linenOptions.map((opt) => {
              const optionId = Number(opt.id);
              const entry = defaults.get(optionId);
              const isAddedByDefault = Boolean(entry);
              const isOffered = Boolean(entry && entry.offered);
              const isSaving = busy.has(optionId);
              return (
                <Box
                  key={optionId}
                  sx={{
                    p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1,
                    display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5,
                    bgcolor: isAddedByDefault ? 'action.hover' : 'background.paper',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{opt.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {Number(opt.countsAsBedLinen) === 1 && Number(opt.countsAsBathroomLinen) === 1
                        ? 'Linge de lit + serviettes'
                        : Number(opt.countsAsBedLinen) === 1 ? 'Linge de lit' : 'Linge de toilette'}
                    </Typography>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }} sx={{ alignItems: 'center' }}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={isAddedByDefault}
                          disabled={isSaving}
                          onChange={(e) => toggleAddedByDefault(optionId, e.target.checked)}
                        />
                      )}
                      label="Ajouter par défaut"
                    />
                    <Tooltip title={isAddedByDefault ? '' : "Activez d'abord « Ajouter par défaut »"}>
                      <span>
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={isOffered}
                              disabled={!isAddedByDefault || isSaving}
                              onChange={(e) => toggleOffered(optionId, e.target.checked)}
                            />
                          )}
                          label="Offert (gratuit)"
                        />
                      </span>
                    </Tooltip>
                    {isSaving && <CircularProgress size={16} />}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
