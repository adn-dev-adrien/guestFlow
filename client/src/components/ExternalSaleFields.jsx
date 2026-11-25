/**
 * ExternalSaleFields — the three catalogue fields of an article sold with no stay (specs/pricing-components.md rules 53, 88; specs/outside-booking-sas.md rule 11):
 * « Vendable hors séjour », the VAT class of the article, and the external customer's rate of that class. Generic: the option and the resource editors both draw it; it knows no
 * form, only a value and the server's list of classes with their rate.
 *
 * The rate belongs to the whole class: changing it from one article changes every article of the class — the field says so. The server judges everything (a family that reads the stay,
 * a missing rate, the range): its refusals come back as `errors`; nothing is validated here but what the operator typed being a readable number.
 *
 * Props:
 *   value      { sellableExternally: bool, vatClass: string ('' = the class of its kind), externalVatRate: string | null } (null = untouched: the class's own rate shows; a string, even empty, is what the operator typed)
 *   onChange   (patch) => void   `{ sellableExternally }`, `{ vatClass }` or `{ externalVatRate }`
 *   classes    [{ vatClass, label, externalRate | null }] — `GET /api/standalone-sales/vat-rates`; the menu lists them with the server's French label
 *   defaultClass  the class used when `vatClass` is empty (`options` or `resources`)
 *   errors     { sellableExternally?, vatClass?, externalVatRate? } — the server's messages
 *   sellability  { sellable, reason } | null — `GET /api/standalone-sales/sellability` for the article being edited (pricing-components rule 124); null while unknown: the switch then keeps its state.
 *              Not sellable and unchecked: the switch is inert but stays focusable (`aria-disabled`) and the helper reads the reason. Not sellable but checked (a row saved before): the switch stays
 *              active so it can be unchecked, and the helper shows the reason in the error colour followed by « Décocher pour enregistrer. »
 *   disabled   boolean
 */
import React, { useId } from 'react';
import { Box, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';

const TEXTS = Object.freeze({
  sellable: 'Vendable hors séjour',
  sellableHelp: 'Proposé au comptoir et à l’arrivée d’un client sans séjour.',
  vatClass: 'Classe de TVA',
  rate: 'Taux client extérieur (%)',
  uncheck: 'Décocher pour enregistrer.',
  rateHelp: (label) => `Taux de toute la classe « ${label} » pour une vente sans séjour. Le taux des séjours reste celui de Réglages → TVA.`,
});

export default function ExternalSaleFields({
  value, onChange, classes = [], defaultClass = 'options', errors = {}, disabled = false, sellability = null,
}) {
  const effective = value.vatClass || defaultClass;
  const known = classes.find((c) => c.vatClass === effective);
  const labelId = useId();
  const helperId = useId();
  const checked = Boolean(value.sellableExternally);
  const refused = Boolean(sellability) && sellability.sellable === false;
  const inert = refused && !checked;
  const stale = refused && checked;
  const helper = stale ? `${sellability.reason} ${TEXTS.uncheck}` : (errors.sellableExternally || (inert && sellability.reason) || TEXTS.sellableHelp);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <FormControlLabel
          sx={{ m: 0, minHeight: 44 }}
          control={(
            <Switch
              checked={checked}
              disabled={disabled}
              onChange={(e) => { if (!inert) onChange({ sellableExternally: e.target.checked }); }}
              sx={inert ? { opacity: (theme) => theme.palette.action.disabledOpacity } : undefined}
              slotProps={{ input: { 'aria-disabled': inert || undefined, 'aria-describedby': helperId } }}
            />
          )}
          label={TEXTS.sellable}
        />
        <FormHelperText id={helperId} sx={{ mt: 0 }} error={stale || Boolean(errors.sellableExternally)}>{helper}</FormHelperText>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
        <FormControl fullWidth disabled={disabled} error={Boolean(errors.vatClass)}>
          <InputLabel id={labelId}>{TEXTS.vatClass}</InputLabel>
          <Select
            labelId={labelId}
            label={TEXTS.vatClass}
            value={known ? effective : ''}
            onChange={(e) => onChange({ vatClass: e.target.value, externalVatRate: null })}
          >
            {classes.map((c) => <MenuItem key={c.vatClass} value={c.vatClass}>{c.label}</MenuItem>)}
          </Select>
          {errors.vatClass && <FormHelperText>{errors.vatClass}</FormHelperText>}
        </FormControl>
        <TextField
          label={TEXTS.rate}
          value={value.externalVatRate != null ? value.externalVatRate : (known && known.externalRate != null ? String(known.externalRate).replace('.', ',') : '')}
          onChange={(e) => onChange({ externalVatRate: e.target.value })}
          disabled={disabled}
          error={Boolean(errors.externalVatRate)}
          helperText={errors.externalVatRate || undefined}
          slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 16, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } }}
        />
      </Box>
      {known && <Typography variant="caption" color="text.secondary">{TEXTS.rateHelp(known.label)}</Typography>}
    </Box>
  );
}
