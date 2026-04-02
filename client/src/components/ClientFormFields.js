import React from 'react';
import { Box, TextField, IconButton, Button, Autocomplete } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import FormRow from './FormRow';

export default function ClientFormFields({ form, setForm, cityOptions }) {
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

      <TextField label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(form.phoneNumbers || ['']).map((p, idx) => (
          <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label={idx === 0 ? 'Téléphone principal' : `Téléphone ${idx + 1}`}
              value={p}
              onChange={(e) => {
                const next = [...(form.phoneNumbers || [])];
                next[idx] = e.target.value;
                setForm({ ...form, phoneNumbers: next });
              }}
              fullWidth
            />
            <IconButton
              color="error"
              onClick={() => {
                const next = [...(form.phoneNumbers || [])];
                next.splice(idx, 1);
                setForm({ ...form, phoneNumbers: next.length ? next : [''] });
              }}
              disabled={(form.phoneNumbers || []).length <= 1}
            >
              <RemoveCircleOutlineIcon />
            </IconButton>
          </Box>
        ))}
        <Button
          variant="text"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => setForm({ ...form, phoneNumbers: [...(form.phoneNumbers || []), ''] })}
          sx={{ alignSelf: 'flex-start' }}
        >
          Ajouter un autre numéro
        </Button>
      </Box>

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
