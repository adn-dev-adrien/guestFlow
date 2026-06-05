import React from 'react';
import { Box, Card, CardContent, Typography, Stack, TextField } from '@mui/material';
import { useReservationForm } from './ReservationFormContext';

/**
 * Voyageurs card: guest counts + capacity warning.
 *
 * specs/bed-config-in-linen-card.md §3 rule 1 (2026-06-05) — bed counters (lits doubles /
 * simples / bébé), "Suggérer les lits" button, and the `bedsCapacityMismatch` warning
 * moved out of this card and into the "Linge de lit" option card inside `ExtrasSection`
 * (rendered there only when the bed-linen option is enabled). Title renamed from
 * "Voyageurs et couchages" → "Voyageurs" to reflect the smaller scope.
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
  } = useReservationForm();

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Voyageurs</Typography>
        <Stack spacing={2.25}>
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
