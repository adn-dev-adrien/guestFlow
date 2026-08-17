import React from 'react';
import { Box, Stack, Typography, TextField, Chip } from '@mui/material';

/**
 * OccurrenceGrid — the moments of a card option, as one row per day with a selectable chip per
 * time slot (specs/option-planning-card.md §3.2).
 *
 * Shared by the reservation fiche (where the operator schedules what the guest buys) and the arrival
 * SAS (where the same moments are sold at check-in — specs/sas-breakfast-and-catering-upsell.md).
 * Purely presentational: the caller owns the grid and the billed-quantity caption.
 *
 * Props:
 *  - grid            [{ date, time, slot, checked }] — the candidate moments
 *  - onToggle        (date, slot, checked) => void
 *  - slotTimes       [{ slot, time }] — when set, renders the editable default-hour fields
 *  - onSlotTimeChange(slot, time) => void — required with `slotTimes`
 *  - quantityText    right-aligned caption (e.g. « Quantité : 6 (3 × 2 pers.) »)
 *  - disabled        read-only rendering
 *  - emptyText       shown instead of the grid when there is no candidate
 */

// French day-of-week + date label for an occurrence row (e.g. « lun. 7 juil. »).
function occurrenceDateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso || '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function OccurrenceGrid({
  grid = [], onToggle, slotTimes, onSlotTimeChange, quantityText, disabled = false, emptyText,
}) {
  if (grid.length === 0) {
    return emptyText
      ? <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{emptyText}</Typography>
      : null;
  }

  const slots = [...new Set(grid.map((o) => o.slot ?? 0))].sort((a, b) => a - b);
  const multi = slots.length > 1;
  const days = [...new Set(grid.map((o) => o.date))].sort();
  const entriesFor = (date) => grid.filter((o) => o.date === date).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      {/* Editable default hour(s) — shared across all days (specs/option-planning-card.md §3.2). */}
      {slotTimes && (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
            {multi ? 'Heures (par défaut)' : 'Heure (par défaut)'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
            {slotTimes.map(({ slot, time }) => (
              <TextField
                key={slot}
                size="small"
                type="time"
                label={multi ? `Créneau ${slot + 1}` : undefined}
                value={time}
                onChange={(e) => onSlotTimeChange(slot, e.target.value)}
                disabled={disabled}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 130 }}
              />
            ))}
          </Stack>
        </>
      )}

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          {multi ? 'Créneaux par jour' : 'Jours concernés'}
        </Typography>
        {quantityText && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{quantityText}</Typography>
        )}
      </Stack>

      {/* One row per day; each present créneau is a selectable chip. */}
      <Stack spacing={0.5}>
        {days.map((date) => (
          <Box key={date} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ minWidth: 104, textTransform: 'capitalize', color: 'text.secondary' }}>
              {occurrenceDateLabel(date)}
            </Typography>
            {entriesFor(date).map((o) => (
              <Chip
                key={o.slot ?? 0}
                label={o.time || '—'}
                size="small"
                color={o.checked ? 'primary' : 'default'}
                variant={o.checked ? 'filled' : 'outlined'}
                onClick={disabled ? undefined : () => onToggle(date, o.slot ?? 0, !o.checked)}
                sx={{ height: 24, fontWeight: 600 }}
              />
            ))}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
