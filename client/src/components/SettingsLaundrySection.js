/**
 * SettingsLaundrySection — "Linge & blanchisserie" settings card.
 *
 * Single field: which weekday Adrien drops the dirty linen at / picks the clean linen from
 * the laundry. Drives the LaundryDayCard on PlanningPage (specs/weekly-bed-linen-tracking.md).
 *
 * Mirrors the shape of SettingsReservationLockSection (Card → Stack → h6 → caption) so the
 * page rhythm stays consistent.
 *
 * Props:
 *   value:    number  // 0..6, Date.getDay() convention
 *   error:    string|null
 *   onChange: (next: number) => void
 *   disabled: boolean
 */
import React from 'react';
import {
  Card, CardContent, Stack, Typography, Box, TextField, MenuItem,
} from '@mui/material';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import { WEEKDAY_OPTIONS } from '../constants/weekdays';

export default function SettingsLaundrySection({
  value = 2,
  error = null,
  onChange,
  disabled = false,
}) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalLaundryServiceIcon color="action" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Linge & blanchisserie
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Jour de la semaine où vous déposez et récupérez le linge à la blanchisserie. Le
            Planning affichera, ce jour-là, le nombre de parures à apporter (depuis la semaine
            écoulée) et à récupérer (déposées la semaine précédente).
          </Typography>

          <TextField
            select
            label="Jour de blanchisserie"
            value={Number.isInteger(Number(value)) ? Number(value) : 2}
            onChange={(e) => onChange(Number(e.target.value))}
            error={Boolean(error)}
            helperText={error || ''}
            disabled={disabled}
            sx={{ maxWidth: { xs: '100%', sm: 320 } }}
          >
            {WEEKDAY_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </CardContent>
    </Card>
  );
}
