/**
 * MentionEditor — the form of one email mention (specs/plugins-phase-p-productisation.md rule 7):
 * its section, its options, the price it quotes, its proposal and confirmation texts. Specific to
 * « Textes des mails ».
 *
 * Props:
 *   value     { section, optionIds, priceSource, priceOptionId, offerFr, offerEn, bookedFr, bookedEn }
 *   onChange  (next) => void
 *   options   [{ id, title }] — the catalogue
 *   error     { field, message } | null — the server's refusal
 */
import React from 'react';
import {
  Autocomplete, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select, Stack, TextField,
} from '@mui/material';
import TokenTextField from './TokenTextField';

export const SECTIONS = [
  { value: 'local', label: 'Produits locaux' },
  { value: 'extras', label: 'À prévoir' },
  { value: 'kids', label: 'Enfants' },
];

export default function MentionEditor({ value, onChange, options, error }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const chosen = options.filter((o) => (value.optionIds || []).includes(o.id));
  const err = (field) => (error && error.field === field ? error.message : '');

  return (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth>
        <InputLabel id="mention-section">Section</InputLabel>
        <Select labelId="mention-section" label="Section" value={value.section} onChange={(e) => set({ section: e.target.value })}>
          {SECTIONS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
        </Select>
      </FormControl>
      <Autocomplete
        multiple
        size="small"
        options={options}
        value={chosen}
        getOptionLabel={(o) => o.title}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, list) => {
          const ids = list.map((o) => o.id);
          set({ optionIds: ids, priceOptionId: ids.includes(value.priceOptionId) ? value.priceOptionId : null });
        }}
        renderInput={(params) => <TextField {...params} label="Options citées" error={Boolean(err('optionIds'))} helperText={err('optionIds') || ' '} />}
      />
      <RadioGroup row value={value.priceSource} onChange={(e) => set({ priceSource: e.target.value })}>
        <FormControlLabel value="min" control={<Radio />} label="Prix le plus bas" />
        <FormControlLabel value="option" control={<Radio />} label="Prix d'une option" disabled={!chosen.length} />
      </RadioGroup>
      {value.priceSource === 'option' && (
        <FormControl size="small" fullWidth error={Boolean(err('priceOptionId'))}>
          <InputLabel id="mention-price">Option dont le prix est cité</InputLabel>
          <Select labelId="mention-price" label="Option dont le prix est cité" value={value.priceOptionId ?? ''} onChange={(e) => set({ priceOptionId: e.target.value })}>
            {chosen.map((o) => <MenuItem key={o.id} value={o.id}>{o.title}</MenuItem>)}
          </Select>
        </FormControl>
      )}
      <TokenTextField
        label="Proposition (J-7)"
        fr={value.offerFr}
        en={value.offerEn}
        onChange={(lang, text) => set({ [lang === 'fr' ? 'offerFr' : 'offerEn']: text })}
        tokens={['price']}
        flags={['hasPrice']}
        errorFr={err('offerFr')}
        errorEn={err('offerEn')}
      />
      <TokenTextField
        label="Confirmation (J-2)"
        fr={value.bookedFr}
        en={value.bookedEn}
        onChange={(lang, text) => set({ [lang === 'fr' ? 'bookedFr' : 'bookedEn']: text })}
        errorFr={err('bookedFr')}
        errorEn={err('bookedEn')}
      />
    </Stack>
  );
}
