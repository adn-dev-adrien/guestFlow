/**
 * ExternalSaleFields — the three catalogue fields of an article sold with no stay (specs/pricing-components.md rules 53, 88; specs/outside-booking-sas.md rule 11):
 * « Vendable hors séjour », the VAT class of the article, and the external customer's rate of that class. Generic: the option and the resource editors both draw it; it knows no
 * form, only a value and the server's list of classes with their rate.
 *
 * The rate belongs to the whole class: changing it from one article changes every article of the class — the field says so. The server judges everything (a family that reads the stay,
 * a missing rate, the range): its refusals come back as `errors`; nothing is validated here but what the operator typed being a readable number.
 *
 * Props:
 *   value      { sellableExternally: bool, vatClass: string ('' = the class of its kind), externalVatRate: string }
 *   onChange   (patch) => void   `{ sellableExternally }`, `{ vatClass }` or `{ externalVatRate }`
 *   classes    [{ vatClass, externalRate | null }] — `GET /api/standalone-sales/vat-rates`
 *   defaultClass  the class used when `vatClass` is empty (`options` or `resources`)
 *   errors     { sellableExternally?, vatClass?, externalVatRate? } — the server's messages
 *   disabled   boolean
 */
import React from 'react';
import { Box, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';

export const VAT_CLASS_LABELS = Object.freeze({
  options: 'Options', resources: 'Ressources', drinks: 'Boissons', catering: 'Restauration',
});

const TEXTS = Object.freeze({
  sellable: 'Vendable hors séjour',
  sellableHelp: 'Proposé au comptoir et à l’arrivée d’un client sans séjour.',
  vatClass: 'Classe de TVA',
  rate: 'Taux client extérieur (%)',
  rateHelp: (label) => `Taux de toute la classe « ${label} » pour une vente sans séjour. Le taux des séjours reste celui de Réglages → TVA.`,
});

export default function ExternalSaleFields({
  value, onChange, classes = [], defaultClass = 'options', errors = {}, disabled = false,
}) {
  const effective = value.vatClass || defaultClass;
  const known = classes.find((c) => c.vatClass === effective);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <FormControlLabel
          sx={{ m: 0, minHeight: 44 }}
          control={<Switch checked={Boolean(value.sellableExternally)} disabled={disabled} onChange={(e) => onChange({ sellableExternally: e.target.checked })} />}
          label={TEXTS.sellable}
        />
        <FormHelperText sx={{ mt: 0 }} error={Boolean(errors.sellableExternally)}>{errors.sellableExternally || TEXTS.sellableHelp}</FormHelperText>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
        <FormControl fullWidth disabled={disabled} error={Boolean(errors.vatClass)}>
          <InputLabel id="external-vat-class">{TEXTS.vatClass}</InputLabel>
          <Select
            labelId="external-vat-class"
            label={TEXTS.vatClass}
            value={effective}
            onChange={(e) => onChange({ vatClass: e.target.value, externalVatRate: '' })}
          >
            {Object.entries(VAT_CLASS_LABELS).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </Select>
          {errors.vatClass && <FormHelperText>{errors.vatClass}</FormHelperText>}
        </FormControl>
        <TextField
          label={TEXTS.rate}
          value={value.externalVatRate !== '' && value.externalVatRate != null ? value.externalVatRate : (known && known.externalRate != null ? String(known.externalRate).replace('.', ',') : '')}
          onChange={(e) => onChange({ externalVatRate: e.target.value })}
          disabled={disabled}
          error={Boolean(errors.externalVatRate)}
          helperText={errors.externalVatRate || undefined}
          slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 16, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary">{TEXTS.rateHelp(VAT_CLASS_LABELS[effective])}</Typography>
    </Box>
  );
}
