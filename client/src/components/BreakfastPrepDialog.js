/**
 * BreakfastPrepDialog — « what to prepare » popup for a planning breakfast card
 * (specs/planning-breakfast-prep-popup.md).
 *
 * Renders ONLY the non-zero items of the breakfast composition, each with the same
 * pictogram as the check-in SAS, plus the serving time (amber pill) and the note.
 * Feature-local: 100 % breakfast-domain content. fullScreen under `sm` (DS rule §3.3).
 *
 * Props:
 *   item        — the mapped breakfast card item ({ reservationId, time, date, clientName,
 *                 propertyName, breakfastPersons, coffee, tea, chocolate, milk, pastries,
 *                 cereals, note }) or null (dialog closed / nothing selected)
 *   open        — boolean
 *   onClose     — () => void («Fermer», backdrop, Escape)
 *   onOpenFiche — () => void («Fiche» — the caller closes and navigates)
 */
import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Chip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { amber } from '@mui/material/colors';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PeopleIcon from '@mui/icons-material/People';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import GrainIcon from '@mui/icons-material/Grain';
import EventNoteIcon from '@mui/icons-material/EventNote';

function formatDayLong(date) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function PrepRow({ icon, label, count }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 40 }}>
      {icon}
      <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
      {count != null && <Typography sx={{ fontWeight: 800 }}>× {count}</Typography>}
    </Box>
  );
}

export default function BreakfastPrepDialog({ item, open, onClose, onOpenFiche }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const it = item || {};

  const persons = Number(it.breakfastPersons) || 0;
  const lines = [
    { key: 'coffee', icon: <LocalCafeIcon color="action" />, label: 'Café', n: Number(it.coffee) || 0 },
    { key: 'tea', icon: <EmojiFoodBeverageIcon color="action" />, label: 'Thé', n: Number(it.tea) || 0 },
    { key: 'chocolate', icon: <FreeBreakfastIcon color="action" />, label: 'Chocolat chaud', n: Number(it.chocolate) || 0 },
    { key: 'milk', icon: <LocalDrinkIcon color="action" />, label: 'Lait', n: Number(it.milk) || 0 },
    { key: 'pastries', icon: <BakeryDiningIcon color="action" />, label: 'Viennoiseries', n: Number(it.pastries) || 0 },
    { key: 'cereals', icon: <GrainIcon color="action" />, label: 'Céréales', n: Number(it.cereals) || 0 },
  ].filter((l) => l.n > 0);
  const note = String(it.note || '').trim();
  const emptyComposition = lines.length === 0 && !note;
  const dayLabel = formatDayLong(it.date);

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FreeBreakfastIcon sx={{ color: amber[800] }} />
          <Box sx={{ flexGrow: 1, fontWeight: 800 }}>Petit déjeuner</Box>
          {it.time && (
            <Chip
              icon={<AccessTimeIcon sx={{ fontSize: 18, color: 'white !important' }} />}
              label={it.time}
              sx={{
                height: 30, fontSize: 16, fontWeight: 800, borderRadius: 1.5, color: 'white',
                bgcolor: amber[800], '& .MuiChip-icon': { ml: 0.75, mr: -0.25 },
              }}
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {[it.clientName, it.propertyName].filter(Boolean).join(' · ')}
          {dayLabel ? ` — ${dayLabel}` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <PrepRow
          icon={<PeopleIcon color="action" />}
          label={`${persons} petit${persons > 1 ? 's' : ''} déjeuner${persons > 1 ? 's' : ''}`}
        />
        {emptyComposition ? (
          <Typography color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
            Composition non renseignée (à compléter au check-in).
          </Typography>
        ) : (
          <>
            {lines.map((l) => <PrepRow key={l.key} icon={l.icon} label={l.label} count={l.n} />)}
            {note && (
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mt: 1 }}>
                <EventNoteIcon color="action" sx={{ mt: 0.25 }} />
                <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>{note}</Typography>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1, '& > *': { width: { xs: '100%', sm: 'auto' } }, px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={onOpenFiche}>Fiche</Button>
        <Button variant="contained" onClick={onClose} sx={{ ml: { xs: 0, sm: 1 } }}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
}
