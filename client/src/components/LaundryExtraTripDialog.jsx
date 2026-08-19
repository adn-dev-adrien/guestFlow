/**
 * LaundryExtraTripDialog — create or edit an extra laundry trip on a free date
 * (specs/laundry-extra-trip.md §3.5 rule 18 + §6).
 *
 * The operator picks a date (create mode; fixed in edit mode), reads the server preview — what the
 * trip would drop and what sits at the laundry that day — then chooses « Tout récupérer » (default)
 * or « Récupérer une partie », which reveals one capped `QuantityField` per linen type present at
 * the laundry. Everything is computed server-side: the dialog only renders the preview payload and
 * sends back `{ pickUpAll, pickUp }`.
 *
 * Props:
 *   open, mode ('create' | 'edit'), date (ISO, required in edit mode; the initial value in create
 *   mode — defaults to today), current ({ pickUpAll, pickUp } | null, edit mode), saving,
 *   onClose(), onSave(date, { pickUpAll, pickUp }).
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Button, Stack, Typography, Box, Divider,
  RadioGroup, FormControlLabel, Radio, CircularProgress, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { cyan } from '@mui/material/colors';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import api from '../api';
import DateField from './DateField';
import QuantityField from './QuantityField';
import { formatLinenBlock } from '../utils/formatLinen';

const GROUPS = [
  { title: 'Draps', items: [{ key: 'doubleBeds', label: 'Double' }, { key: 'singleBeds', label: 'Simple' }, { key: 'babyBeds', label: 'Bébé' }] },
  { title: 'Serviettes', items: [{ key: 'largeTowels', label: 'Grande' }, { key: 'mediumTowels', label: 'Moyenne' }, { key: 'smallTowels', label: 'Petite' }, { key: 'bathMats', label: 'Tapis de bain' }] },
];
const ALL_KEYS = GROUPS.flatMap((g) => g.items.map((i) => i.key));
const ZEROS = Object.fromEntries(ALL_KEYS.map((k) => [k, 0]));
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function frDate(iso) {
  if (!iso) return '';
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }); }
  catch { return iso; }
}

function poolValue(pool, key) {
  return Math.max(0, Math.floor(Number(pool && pool[key]) || 0));
}

const PREVIEW_ERRORS = {
  EXTRA_TRIP_ON_LAUNDRY_DAY: 'Ce jour est déjà un jour de blanchisserie.',
  INVALID_DATE: 'Date invalide.',
};

export default function LaundryExtraTripDialog({ open, mode = 'create', date, current, saving = false, onClose, onSave }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const isEdit = mode === 'edit';
  const [draftDate, setDraftDate] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pickMode, setPickMode] = useState('all');
  const [counts, setCounts] = useState(ZEROS);

  // Reset on open: the date (edit: fixed; create: given or today) and the stored mode / counts.
  useEffect(() => {
    if (!open) return;
    setDraftDate(date || todayIso());
    setPickMode(current && current.pickUpAll === false ? 'partial' : 'all');
    setPreview(null);
    setPreviewError(null);
  }, [open, date, current]);

  // Server preview for the chosen date. Guarded against a stale response landing after the date
  // changed again (cancelled flag). The prefill of the partial counts = the pool, capped stored
  // values in edit mode.
  useEffect(() => {
    if (!open || !ISO_DATE_RE.test(draftDate)) return undefined;
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    api.previewLaundryExtraTrip(draftDate)
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        const pool = res && res.atLaundry;
        const stored = current && current.pickUpAll === false ? current.pickUp : null;
        setCounts(Object.fromEntries(ALL_KEYS.map((k) => {
          const max = poolValue(pool, k);
          const value = stored ? Math.min(Math.max(0, Number(stored[k]) || 0), max) : max;
          return [k, value];
        })));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(PREVIEW_ERRORS[err && err.code] || "Impossible de calculer l'aperçu de ce voyage.");
      })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [open, draftDate, current]);

  const pool = preview ? preview.atLaundry : null;
  const poolIsEmpty = !pool || ALL_KEYS.every((k) => poolValue(pool, k) === 0);
  const visibleGroups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => poolValue(pool, it.key) > 0) }))
    .filter((g) => g.items.length > 0);
  const canSave = !saving && !loadingPreview && Boolean(preview) && !previewError && ISO_DATE_RE.test(draftDate);

  const handleSave = () => {
    const pickUpAll = pickMode === 'all' || poolIsEmpty;
    // Types absent from the pool are submitted as 0 so the server always gets a complete block.
    const pickUp = Object.fromEntries(ALL_KEYS.map((k) => [k, poolValue(pool, k) > 0 ? counts[k] : 0]));
    onSave(draftDate, { pickUpAll, pickUp });
  };

  const dropLine = preview ? formatLinenBlock(preview.dropOff) : null;
  const poolLine = preview ? formatLinenBlock(preview.atLaundry) : null;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <Box sx={{ bgcolor: cyan[800], color: '#fff', px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocalLaundryServiceIcon />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>Voyage blanchisserie exceptionnel</Typography>
          <Typography variant="caption" sx={{ opacity: 0.9, textTransform: 'capitalize' }}>{frDate(draftDate)}</Typography>
        </Box>
      </Box>
      <DialogContent sx={{ pt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Vous apportez tout le linge sale accumulé depuis le dernier voyage et récupérez ce qui est à la
          blanchisserie — en totalité ou en partie. Les voyages hebdomadaires suivants et le stock sont recalculés.
        </Typography>
        {isEdit ? (
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 2, textTransform: 'capitalize' }}>{frDate(draftDate)}</Typography>
        ) : (
          <DateField
            label="Date du voyage"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: { xs: '100%', sm: 220 }, mb: 2 }}
          />
        )}

        <Box sx={{ bgcolor: cyan[50], border: '1px solid', borderColor: cyan[200], borderRadius: 1, px: 2, py: 1.5, mb: 2 }}>
          {loadingPreview && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Calcul…</Typography>
            </Stack>
          )}
          {!loadingPreview && previewError && (
            <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>{previewError}</Typography>
          )}
          {!loadingPreview && !previewError && preview && (
            <Stack spacing={0.75}>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 0.5 }}>À apporter ce jour-là :</Box>
                {dropLine || '—'}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 0.5 }}>À la blanchisserie ce jour-là :</Box>
                {poolLine || '—'}
              </Typography>
            </Stack>
          )}
        </Box>

        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Linge récupéré
        </Typography>
        <RadioGroup value={pickMode} onChange={(e) => setPickMode(e.target.value)} sx={{ mb: 1 }}>
          <FormControlLabel value="all" control={<Radio />} label="Tout récupérer" />
          <FormControlLabel
            value="partial"
            control={<Radio />}
            label="Récupérer une partie"
            disabled={poolIsEmpty || Boolean(previewError)}
          />
        </RadioGroup>
        {pickMode === 'partial' && !poolIsEmpty && (
          <Stack spacing={1.5} divider={<Divider />}>
            {visibleGroups.map((g) => (
              <Box key={g.title}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{g.title}</Typography>
                {g.items.map((it) => {
                  const max = poolValue(pool, it.key);
                  return (
                    <Stack
                      key={it.key}
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={{ xs: 0.5, sm: 1 }}
                      sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', py: 0.75 }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {it.label}
                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.75 }}>({max} à la blanchisserie)</Box>
                      </Typography>
                      <QuantityField
                        value={counts[it.key]}
                        onCommit={(v) => setCounts((prev) => ({ ...prev, [it.key]: v }))}
                        min={0}
                        max={max}
                        size="small"
                        aria-label={`${it.label} récupéré`}
                        sx={{ width: { xs: '100%', sm: 170 } }}
                      />
                    </Stack>
                  );
                })}
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}>Enregistrer</Button>
      </DialogActions>
    </Dialog>
  );
}
