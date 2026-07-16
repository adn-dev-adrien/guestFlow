import React from 'react';
import { Box, Card, CardContent, Typography, Stack, TextField } from '@mui/material';
import { useReservationForm } from './ReservationFormContext';

/**
 * Voyageurs card: guest counts + capacity warning.
 *
 * specs/bed-config-in-linen-card.md §3 rule 1 (2026-06-05) — the lits doubles / simples counters,
 * "Suggérer les lits" button, and the `bedsCapacityMismatch` warning live in the "Linge de lit"
 * option card inside `ExtrasSection` (shown only when the bed-linen option is enabled).
 *
 * §10 follow-up (2026-06-08) — the "Lits bébé" counter is the EXCEPTION: a baby bed is an
 * independent resource needed whenever there are babies, so it is shown HERE (always, when
 * babies > 0) instead of being hidden behind the bed-linen option. Title kept "Voyageurs".
 *
 * Reads everything from the reservation form context — no props.
 */
export default function GuestsBedsSection() {
  const {
    formSectionCardSx, lockedSectionSx, formSectionContentSx,
    form, updateForm,
    maxAdultsAllowed, maxBabiesAllowed,
    exceedsAdultsCapacity, exceedsChildrenCapacity, exceedsBabiesCapacity, exceedsTotalCapacity,
    totalGuestsCount, totalGuestsMax,
    maxBabyBedsByRule, remainingBabyBeds,
  } = useReservationForm();

  const showBabyBed = Number(form.babies || 0) > 0;

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="sectionHeader" sx={{ mb: 2 }}>Voyageurs</Typography>
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
            <Box>
              <TextField
                label={`Adultes${maxAdultsAllowed !== null ? ` (max ${maxAdultsAllowed})` : ''}`}
                type="number"
                value={form.adults}
                onChange={(e) => updateForm({ adults: Number(e.target.value) })}
                fullWidth
                error={exceedsAdultsCapacity}
                slotProps={{
                  htmlInput: { min: 1, max: maxAdultsAllowed ?? undefined }
                }}
              />
            </Box>
            <Box>
              <TextField
                label={`Enfants (2 à 12 ans)`}
                type="number"
                value={form.children}
                onChange={(e) => updateForm({ children: Number(e.target.value) })}
                fullWidth
                error={exceedsChildrenCapacity}
                slotProps={{
                  htmlInput: { min: 0 }
                }}
              />
            </Box>
            <Box>
              <TextField
                label={`Ados (12 à 18 ans)`}
                type="number"
                value={form.teens}
                onChange={(e) => updateForm({ teens: Number(e.target.value) })}
                fullWidth
                error={exceedsChildrenCapacity}
                slotProps={{
                  htmlInput: { min: 0 }
                }}
              />
            </Box>
            <Box>
              <TextField
                label={`Bébés (0 à 2 ans)`}
                type="number"
                value={form.babies}
                onChange={(e) => updateForm({ babies: Number(e.target.value) })}
                fullWidth
                error={exceedsBabiesCapacity}
                slotProps={{
                  htmlInput: { min: 0, max: maxBabiesAllowed ?? undefined }
                }}
              />
            </Box>
          </Box>

          {showBabyBed && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <TextField
                label="Lits bébé"
                type="number"
                value={form.babyBeds}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') { updateForm({ babyBeds: '' }); return; }
                  const n = Math.max(0, Number(val));
                  updateForm({ babyBeds: Math.min(n, maxBabyBedsByRule) });
                }}
                fullWidth
                helperText={`Dispo restante: ${remainingBabyBeds === null ? '...' : remainingBabyBeds}`}
                slotProps={{ htmlInput: { min: 0, max: maxBabyBedsByRule } }}
              />
            </Box>
          )}

          {exceedsTotalCapacity && (
            <Typography variant="body2" color="error">
              Capacité totale dépassée: {totalGuestsCount}/{totalGuestsMax} personnes.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
