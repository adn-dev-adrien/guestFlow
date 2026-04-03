import React from 'react';
import { Box, TextField, Button, Typography } from '@mui/material';
import FormRow from './FormRow';

export default function PropertyFormFields({ form, setForm, photoFile, setPhotoFile }) {
  const handleZeroFocus = (e) => {
    if (Number(e.target.value) === 0) {
      requestAnimationFrame(() => e.target.select());
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <TextField label="Nom du logement" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
      <FormRow>
        <TextField label="Max adultes" type="number" value={form.maxAdults} onChange={(e) => setForm({ ...form, maxAdults: e.target.value })} onFocus={handleZeroFocus} fullWidth />
        <TextField label="Max enfants" type="number" value={form.maxChildren} onChange={(e) => setForm({ ...form, maxChildren: e.target.value })} onFocus={handleZeroFocus} fullWidth helperText="2 à 18 ans" />
        <TextField label="Max bébés" type="number" value={form.maxBabies} onChange={(e) => setForm({ ...form, maxBabies: e.target.value })} onFocus={handleZeroFocus} fullWidth helperText="0 à 2 ans" />
      </FormRow>
      <TextField
        label="Taxe de séjour (€/jour/personne)"
        type="number"
        value={form.touristTaxPerDayPerPerson ?? 0}
        onChange={(e) => setForm({ ...form, touristTaxPerDayPerPerson: e.target.value })}
        onFocus={handleZeroFocus}
        fullWidth
        inputProps={{ min: 0, step: 0.01 }}
      />
      <Button variant="outlined" component="label">
        Ajouter une photo
        <input type="file" hidden accept="image/*" onChange={(e) => setPhotoFile(e.target.files[0])} />
      </Button>
      {photoFile && <Typography variant="body2">{photoFile.name}</Typography>}
    </Box>
  );
}
