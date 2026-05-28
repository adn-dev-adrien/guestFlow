import React from 'react';
import {
  Box, Card, CardContent, Typography, Stack, FormControl, InputLabel, Select,
  MenuItem, TextField, FormHelperText
} from '@mui/material';
import MiniPlanningStrip from '../MiniPlanningStrip';
import { TIME_OPTIONS } from '../../constants/timeOptions';
import { useReservationForm } from './ReservationFormContext';

/**
 * Séjour card: property select + mini planning strip + dates + check-in/out times + conflict/min-nights hints.
 * Reads everything from the reservation form context — no props.
 */
export default function StaySection() {
  const {
    formSectionCardSx, lockedSectionSx, formSectionContentSx,
    form, updateForm,
    properties, selectedProp, handleReservationPropertyChange,
    miniCalendarStart, setMiniCalendarStart, miniVisibleDays, reservations,
    editingReservationId, handleMiniDateClick, centerMiniCalendarOnRange, isReservationLocked,
    arrivalMin, arrivalMax, departureMin, departureMax, handleManualDateInputChange,
    datesUnavailableForProperty, datesUnavailableMessage, minNightsState, minNightsWarning,
    liveTimeConflictState, liveTimeConflictMessage, defaultCheckInTime, defaultCheckOutTime,
  } = useReservationForm();

  return (
    <Card variant="outlined" sx={{ ...formSectionCardSx, ...lockedSectionSx }}>
      <CardContent sx={formSectionContentSx}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Séjour</Typography>
        <Stack spacing={2.25}>
          <FormControl fullWidth>
            <InputLabel>Logement</InputLabel>
            <Select
              value={selectedProp}
              label="Logement"
              onChange={(e) => handleReservationPropertyChange(e.target.value)}
            >
              {properties.map(p => <MenuItem key={p.id} value={p.id}>{p.label || p.name}</MenuItem>)}
            </Select>
          </FormControl>

          <MiniPlanningStrip
            miniCalendarStart={miniCalendarStart}
            setMiniCalendarStart={setMiniCalendarStart}
            miniVisibleDays={miniVisibleDays}
            reservations={reservations}
            selectedPropertyId={selectedProp}
            currentReservation={form}
            currentReservationId={editingReservationId}
            onDateClick={handleMiniDateClick}
            onRecenter={() => centerMiniCalendarOnRange(form.startDate, form.endDate)}
            isLocked={isReservationLocked}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <Box>
              <TextField
                label="Date d'arrivée"
                type="date"
                value={form.startDate || ''}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: arrivalMin, max: arrivalMax || undefined }}
                onChange={(e) => handleManualDateInputChange({ startDate: e.target.value })}
                error={datesUnavailableForProperty || minNightsState.breached}
                fullWidth
              />
            </Box>
            <Box>
              <TextField
                label="Date de départ"
                type="date"
                value={form.endDate || ''}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: departureMin || undefined, max: departureMax || undefined }}
                onChange={(e) => handleManualDateInputChange({ endDate: e.target.value })}
                error={datesUnavailableForProperty || minNightsState.breached}
                fullWidth
              />
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <Box>
              <FormControl fullWidth error={Boolean(liveTimeConflictState.arrivalMessage)}>
                <InputLabel>{`Heure d'arrivée (défaut ${defaultCheckInTime})`}</InputLabel>
                <Select
                  value={form.checkInTime}
                  label={`Heure d'arrivée (défaut ${defaultCheckInTime})`}
                  onChange={(e) => updateForm({ checkInTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <Box>
              <FormControl fullWidth error={Boolean(liveTimeConflictState.departureMessage)}>
                <InputLabel>{`Heure de départ (défaut ${defaultCheckOutTime})`}</InputLabel>
                <Select
                  value={form.checkOutTime}
                  label={`Heure de départ (défaut ${defaultCheckOutTime})`}
                  onChange={(e) => updateForm({ checkOutTime: e.target.value })}
                >
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
          </Box>

          {(liveTimeConflictMessage || datesUnavailableForProperty || minNightsState.breached) && (
            <Stack spacing={0.5}>
              {liveTimeConflictMessage && (
                <FormHelperText error>
                  {liveTimeConflictMessage}
                </FormHelperText>
              )}

              {datesUnavailableForProperty && (
                <Typography variant="body2" color="error">
                  {datesUnavailableMessage}
                </Typography>
              )}

              {minNightsState.breached && (
                <Typography variant="body2" color="error">
                  {minNightsWarning}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
