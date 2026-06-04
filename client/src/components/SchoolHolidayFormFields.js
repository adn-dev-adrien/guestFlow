import React from 'react';
import { Box, Typography, Grid, TextField, Alert } from '@mui/material';
import { ZONE_COLORS } from '../constants/schoolHolidayZoneColors';

function ZoneDateFields({ zoneKey, form, setField }) {
  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: ZONE_COLORS[zoneKey] }}>
        {`Zone ${zoneKey}`}
      </Typography>
      <Grid container spacing={2}>
        <Grid
          size={{
            xs: 12,
            sm: 6
          }}>
          <TextField
            label="Début"
            type="date"
            value={form[`zone${zoneKey}_start`]}
            onChange={(e) => setField(`zone${zoneKey}_start`, e.target.value)}
            fullWidth
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid
          size={{
            xs: 12,
            sm: 6
          }}>
          <TextField
            label="Fin"
            type="date"
            value={form[`zone${zoneKey}_end`]}
            onChange={(e) => setField(`zone${zoneKey}_end`, e.target.value)}
            fullWidth
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
      </Grid>
    </>
  );
}

export default function SchoolHolidayFormFields({ form, setField, validationError }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      {validationError ? <Alert severity="error">{validationError}</Alert> : null}
      <TextField label="Nom de la période" value={form.label} onChange={(e) => setField('label', e.target.value)} fullWidth />
      <ZoneDateFields zoneKey="A" form={form} setField={setField} />
      <ZoneDateFields zoneKey="B" form={form} setField={setField} />
      <ZoneDateFields zoneKey="C" form={form} setField={setField} />
    </Box>
  );
}
