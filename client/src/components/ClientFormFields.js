import React from 'react';
import { Box, TextField, Autocomplete } from '@mui/material';
import FormRow from './FormRow';

export default function ClientFormFields({ form, setForm, cityOptions, emailError = false, phoneError = false }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <FormRow>
        <TextField label="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth required />
        <TextField label="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth required />
      </FormRow>

      <FormRow>
        <TextField
          label="N°"
          value={form.streetNumber}
          onChange={(e) => setForm({ ...form, streetNumber: e.target.value })}
          sx={{ width: { xs: '100%', sm: 120 } }}
        />
        <TextField
          label="Rue / voie"
          value={form.street}
          onChange={(e) => setForm({ ...form, street: e.target.value })}
          fullWidth
        />
      </FormRow>

      <FormRow>
        <TextField
          label="Code postal"
          value={form.postalCode}
          onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })}
          sx={{ width: { xs: '100%', sm: 170 } }}
        />
        <Autocomplete
          freeSolo
          options={cityOptions}
          value={form.city || ''}
          onInputChange={(_, val) => setForm({ ...form, city: val || '' })}
          renderInput={(params) => <TextField {...params} label="Ville" fullWidth />}
          fullWidth
        />
      </FormRow>

      <TextField
        label="Email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        fullWidth
        error={emailError}
        helperText={emailError ? 'Format email invalide' : ''}
      />

      <TextField
        label="Téléphone"
        value={form.phone || ''}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        fullWidth
        error={phoneError}
        helperText={phoneError ? 'Format téléphone invalide' : ''}
      />

      <TextField
        label="Adresse complète"
        value={[form.streetNumber, form.street, form.postalCode, form.city].filter(Boolean).join(' ')}
        fullWidth
        InputProps={{ readOnly: true }}
      />
      <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
    </Box>
  );
}
