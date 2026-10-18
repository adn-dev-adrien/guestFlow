/**
 * LaundryManualAdditionsDialog — editor for a laundry trip's manual linen line
 * (specs/manual-laundry-additions.md §6, specs/laundry-manual-removals.md §6).
 *
 * Seven per-type steppers grouped « Draps » (simple / double / bébé) + « Serviettes » (grande /
 * moyenne / petite / tapis), pre-filled with the trip's current values. The values are SIGNED:
 * positive = extra linen to wash on this trip, negative = linen washed outside the laundry, withdrawn
 * from the trip. A value can be typed with its sign (« -3 »): the field keeps what is typed and
 * settles on blur (specs/laundry-manual-removals.md rule 9). Saving calls `onSave(date, counts)`;
 * the parent PUTs and reloads the planning.
 *
 * Props: { open, date, current, saving, onClose, onSave }
 *   current — { singleBeds, doubleBeds, babyBeds, largeTowels, mediumTowels, smallTowels, bathMats } | undefined.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Button, Stack, Typography, Box, Divider, TextField, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { cyan } from '@mui/material/colors';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';

const GROUPS = [
  { title: 'Draps', items: [{ key: 'singleBeds', label: 'Simple' }, { key: 'doubleBeds', label: 'Double' }, { key: 'babyBeds', label: 'Bébé' }] },
  { title: 'Serviettes', items: [{ key: 'largeTowels', label: 'Grande' }, { key: 'mediumTowels', label: 'Moyenne' }, { key: 'smallTowels', label: 'Petite' }, { key: 'bathMats', label: 'Tapis' }] },
];
const ALL_KEYS = GROUPS.flatMap((g) => g.items.map((i) => i.key));
const ZEROS = Object.fromEntries(ALL_KEYS.map((k) => [k, 0]));

function frDate(iso) {
  if (!iso) return '';
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }); }
  catch { return iso; }
}

// What the field holds while typing → the count it means: « -3 » is −3, a lone « - » or an empty
// field is still 0 (rule 9). Exported for the tests.
export function parseSignedCount(raw) {
  const text = String(raw == null ? '' : raw).trim().replace('−', '-');
  if (!/^-?\d+$/.test(text)) return 0;
  return Math.trunc(Number(text));
}

// A signed stepper: « − » keeps going below zero, and a negative line says out loud what it means —
// linen washed outside the laundry (specs/laundry-manual-removals.md §6). The field keeps the raw text
// typed — « - » included — so a sign typed first survives until the digits follow.
function Stepper({ label, value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((current) => (parseSignedCount(current) === value ? current : String(value)));
  }, [value]);
  const withdrawn = value < 0;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        {withdrawn && (
          <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 600 }}>lavé hors blanchisserie</Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => onChange(value - 1)} sx={{ minWidth: 40 }}>−</Button>
        <TextField
          value={draft}
          onChange={(e) => {
            const raw = String(e.target.value);
            if (!/^\s*[-−]?\d*\s*$/.test(raw)) return;
            setDraft(raw);
            onChange(parseSignedCount(raw));
          }}
          onBlur={() => setDraft(String(value))}
          size="small"
          sx={{ width: 64 }}
          slotProps={{ htmlInput: { style: { textAlign: 'center' }, inputMode: 'text', 'aria-label': label } }}
        />
        <Button size="small" variant="outlined" onClick={() => onChange(value + 1)} sx={{ minWidth: 40 }}>+</Button>
      </Stack>
    </Stack>
  );
}

export default function LaundryManualAdditionsDialog({ open, date, current, saving = false, onClose, onSave }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [counts, setCounts] = useState(ZEROS);

  useEffect(() => {
    if (!open) return;
    setCounts({ ...ZEROS, ...Object.fromEntries(ALL_KEYS.map((k) => [k, Math.round(Number(current && current[k]) || 0)])) });
  }, [open, current]);

  const setKey = (k, v) => setCounts((prev) => ({ ...prev, [k]: v }));

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <Box sx={{ bgcolor: cyan[800], color: '#fff', px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocalLaundryServiceIcon />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>Linge ajouté ou retiré</Typography>
          <Typography variant="caption" sx={{ opacity: 0.9, textTransform: 'capitalize' }}>{frDate(date)}</Typography>
        </Box>
      </Box>
      <DialogContent sx={{ pt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Valeur positive : linge à laver ce voyage en plus des réservations. Valeur négative : linge lavé
          hors blanchisserie, retiré du voyage. À apporter, À récupérer et le stock suivent.
        </Typography>
        <Stack spacing={1.5} divider={<Divider />}>
          {GROUPS.map((g) => (
            <Box key={g.title}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{g.title}</Typography>
              {g.items.map((it) => <Stepper key={it.key} label={it.label} value={counts[it.key]} onChange={(v) => setKey(it.key, v)} />)}
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="contained" onClick={() => onSave(date, counts)} disabled={saving}>Enregistrer</Button>
      </DialogActions>
    </Dialog>
  );
}
