/**
 * BillingAddressFields — the optional billing address of a guest with no client record
 * (specs/resource-booking-pricing-and-invoicing.md rules 25-27). The postcode keeps digits only (5 at most); from 2 digits
 * the city field lists the communes of that postcode, and fills itself when only one matches. Free typing stays possible.
 *
 * Props:
 *   value     { street, postcode, city }
 *   onChange  (next) => void
 *   required  boolean — Qonto asked for it: the hint says so
 *   disabled  boolean
 */
import React, { useEffect } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { usePostalCodeCities } from '../sdk';

export default function BillingAddressFields({ value, onChange, required = false, disabled = false }) {
  const address = value || { street: '', postcode: '', city: '' };
  const cities = usePostalCodeCities(address.postcode, '', { enabled: !disabled });
  const set = (patch) => onChange({ ...address, ...patch });

  useEffect(() => {
    if (String(address.postcode || '').length === 5 && cities.length === 1 && !address.city) set({ city: cities[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities]);

  return (
    <Box sx={{ display: 'grid', gap: 1.25, p: 1.5, border: 1, borderStyle: 'dashed', borderColor: required ? 'error.main' : 'divider', borderRadius: 1.5 }}>
      <Typography variant="caption" color={required ? 'error.main' : 'text.secondary'} sx={{ fontWeight: required ? 600 : 400 }}>
        {required ? "Qonto demande l'adresse de facturation pour émettre la facture." : 'Adresse de facturation · facultative'}
      </Typography>
      <TextField label="Adresse" size="small" value={address.street || ''} onChange={(e) => set({ street: e.target.value })} disabled={disabled} autoComplete="street-address" fullWidth />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 1fr) 2fr', gap: 1.25 }}>
        <TextField
          label="Code postal"
          size="small"
          value={address.postcode || ''}
          onChange={(e) => set({ postcode: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })}
          disabled={disabled}
          autoComplete="postal-code"
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 5 } }}
        />
        <Autocomplete
          freeSolo
          options={cities}
          value={address.city || ''}
          inputValue={address.city || ''}
          onInputChange={(_, next) => set({ city: next })}
          onChange={(_, next) => set({ city: next || '' })}
          disabled={disabled}
          renderInput={(params) => <TextField {...params} label="Ville" size="small" autoComplete="address-level2" />}
        />
      </Box>
      <Typography variant="caption" color="text.secondary">Chiffres uniquement. Dès 2 chiffres, les communes du code postal s'affichent.</Typography>
    </Box>
  );
}
