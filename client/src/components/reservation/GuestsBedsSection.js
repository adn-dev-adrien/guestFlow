import React from 'react';
import { Box, Card, CardContent, Typography, Stack, TextField, Button } from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useReservationForm } from './ReservationFormContext';

/**
 * Voyageurs et couchages card: guest counts, bed counts, capacity warnings and "Suggérer les lits".
 * Reads everything from the reservation form context — no props.
 */
export default function GuestsBedsSection() {
  const {
    formSectionCardSx, lockedSectionSx, formSectionContentSx,
    form, updateForm,
    maxAdultsAllowed, maxBabiesAllowed, maxSingleBeds, maxDoubleBeds,
    exceedsAdultsCapacity, exceedsChildrenCapacity, exceedsBabiesCapacity, exceedsTotalCapacity,
    exceedsSingleBedsLimit, exceedsDoubleBedsLimit, bedsCapacityMismatch,
    totalGuestsCount, totalGuestsMax, reservationBedCapacity, requiredRegularBeds,
    maxBabyBedsByRule, remainingBabyBeds, handleSuggestBeds, selectedProp, isReservationLocked,
  } = useReservationForm();

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Voyageurs et couchages</Typography>
        <Stack spacing={2.25}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
            <Box>
              <TextField
                label={`Adultes${maxAdultsAllowed !== null ? ` (max ${maxAdultsAllowed})` : ''}`}
                type="number"
                value={form.adults}
                onChange={(e) => updateForm({ adults: Number(e.target.value) })}
                fullWidth
                inputProps={{ min: 1, max: maxAdultsAllowed ?? undefined }}
                error={exceedsAdultsCapacity}
              />
            </Box>
            <Box>
              <TextField
                label={`Enfants (2 à 12 ans)`}
                type="number"
                value={form.children}
                onChange={(e) => updateForm({ children: Number(e.target.value) })}
                fullWidth
                inputProps={{ min: 0 }}
                error={exceedsChildrenCapacity}
              />
            </Box>
            <Box>
              <TextField
                label={`Ados (12 à 18 ans)`}
                type="number"
                value={form.teens}
                onChange={(e) => updateForm({ teens: Number(e.target.value) })}
                fullWidth
                inputProps={{ min: 0 }}
                error={exceedsChildrenCapacity}
              />
            </Box>
            <Box>
              <TextField
                label={`Bébés (0 à 2 ans)`}
                type="number"
                value={form.babies}
                onChange={(e) => updateForm({ babies: Number(e.target.value) })}
                fullWidth
                inputProps={{ min: 0, max: maxBabiesAllowed ?? undefined }}
                error={exceedsBabiesCapacity}
              />
            </Box>
          </Box>

          {exceedsTotalCapacity && (
            <Typography variant="body2" color="error">
              Capacité totale dépassée: {totalGuestsCount}/{totalGuestsMax} personnes.
            </Typography>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
            <Box>
              <TextField
                label="Lits doubles"
                type="number"
                value={form.doubleBeds}
                onChange={(e) => updateForm({ doubleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                fullWidth
                error={bedsCapacityMismatch || exceedsDoubleBedsLimit}
                helperText={exceedsDoubleBedsLimit ? `Maximum logement: ${maxDoubleBeds}` : ''}
                inputProps={{ min: 0, max: maxDoubleBeds ?? undefined }}
              />
            </Box>
            <Box>
              <TextField
                label="Lits simples"
                type="number"
                value={form.singleBeds}
                onChange={(e) => updateForm({ singleBeds: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
                fullWidth
                error={bedsCapacityMismatch || exceedsSingleBedsLimit}
                helperText={exceedsSingleBedsLimit ? `Maximum logement: ${maxSingleBeds}` : ''}
                inputProps={{ min: 0, max: maxSingleBeds ?? undefined }}
              />
            </Box>
            <Box>
              <TextField
                label="Lits bébé"
                type="number"
                value={form.babyBeds}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    updateForm({ babyBeds: '' });
                    return;
                  }
                  const n = Math.max(0, Number(val));
                  updateForm({ babyBeds: Math.min(n, maxBabyBedsByRule) });
                }}
                fullWidth
                inputProps={{ min: 0, max: maxBabyBedsByRule }}
                helperText={`Dispo restante: ${remainingBabyBeds === null ? '...' : remainingBabyBeds}`}
              />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="text"
              startIcon={<AutoFixHighIcon fontSize="small" />}
              onClick={handleSuggestBeds}
              disabled={!selectedProp || isReservationLocked}
              sx={{ textTransform: 'none' }}
            >
              Suggérer les lits
            </Button>
          </Box>

          {bedsCapacityMismatch && (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              Attention: la capacité des lits classiques saisis ({reservationBedCapacity}) est inférieure au besoin réel ({requiredRegularBeds}). Les enfants de 2 à 12 ans placés en lit bébé sont déduits automatiquement du calcul.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
