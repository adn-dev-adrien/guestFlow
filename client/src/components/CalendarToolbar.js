import React from 'react';
import { Card, CardContent, FormControl, InputLabel, Select, MenuItem, Button, Box, Typography, Chip } from '@mui/material';
import { CLEANING_COLOR, ZONE_COLORS } from '../utils/calendarVisuals';

/**
 * CalendarToolbar — property selector + month navigation + colour legend for the calendar.
 * Pure presentational; the parent supplies the property list and the action callbacks.
 *
 * Props:
 *  - properties: { id, name }[]
 *  - selectedProp: number|string ('' = overview mode)
 *  - onSelectProperty: (id) => void
 *  - onClearProperty: () => void
 *  - onPrevMonth / onNextMonth / onToday: () => void
 */
export default function CalendarToolbar({ properties, selectedProp, onSelectProperty, onClearProperty, onPrevMonth, onNextMonth, onToday }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap' }}>
        <FormControl sx={{ minWidth: { xs: '100%', sm: 250 } }}>
          <InputLabel>Logement</InputLabel>
          <Select value={selectedProp} label="Logement" onChange={(e) => onSelectProperty(e.target.value)}>
            {properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </Select>
        </FormControl>
        {selectedProp && (
          <Button variant="text" onClick={onClearProperty}>Vue logements</Button>
        )}
        {selectedProp && (
          <Button variant="outlined" onClick={onPrevMonth} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Mois précédent
          </Button>
        )}
        {selectedProp && (
          <Button variant="outlined" onClick={onNextMonth} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Mois suivant
          </Button>
        )}
        <Button variant="outlined" onClick={onToday} sx={{ width: { xs: '100%', sm: 'auto' } }}>Aujourd'hui</Button>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label="Ménage" size="small" sx={{ bgcolor: CLEANING_COLOR, color: 'white' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.A }} />
            <Typography variant="caption" color="text.secondary">Zone A</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.B }} />
            <Typography variant="caption" color="text.secondary">Zone B</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS.C }} />
            <Typography variant="caption" color="text.secondary">Zone C</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
