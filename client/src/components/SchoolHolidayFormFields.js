import React from 'react';
import { Box, Typography, Grid, TextField } from '@mui/material';

function ZoneDateFields({ zoneKey, form, setField }) {
  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{`Zone ${zoneKey}`}</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Début"
            type="date"
            value={form[`zone${zoneKey}_start`]}
            InputLabelProps={{ shrink: true }}
            onChange={(e) => setField(`zone${zoneKey}_start`, e.target.value)}
            fullWidth
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Fin"
            type="date"
            value={form[`zone${zoneKey}_end`]}
            InputLabelProps={{ shrink: true }}
            onChange={(e) => setField(`zone${zoneKey}_end`, e.target.value)}
            fullWidth
          />
        </Grid>
      </Grid>
    </>
  );
}

export default function SchoolHolidayFormFields({ form, setField }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      <TextField label="Nom de la période" value={form.label} onChange={(e) => setField('label', e.target.value)} fullWidth />
      <ZoneDateFields zoneKey="A" form={form} setField={setField} />
      <ZoneDateFields zoneKey="B" form={form} setField={setField} />
      <ZoneDateFields zoneKey="C" form={form} setField={setField} />
    </Box>
  );
}
