/**
 * AddOnsPicker — the options a voucher offers on top of its contents (specs/gift-voucher-campaigns.md rule 4): picked in the server's catalogue, those that cannot be
 * sold outside a stay listed greyed with the server's reason. Used by the campaign editor and by « Sur mesure ».
 *
 * Props: value (articleRef[]), onChange(articleRef[]), elements (the server's catalogue), errors? ([{ field, message }] — the refusals of `addOns[i]`), label
 */
import React from 'react';
import { Autocomplete, TextField, Typography } from '@mui/material';
import { COMPOSITION_TEXTS as T } from './giftVoucherTexts';

export default function AddOnsPicker({
  value, onChange, elements, errors = [], label, helperText,
}) {
  const options = elements.filter((e) => e.kind === 'option');
  const selected = value.map((ref) => options.find((o) => o.articleRef === ref)).filter(Boolean);
  const problems = errors.filter((e) => /^addOns\[\d+\]$/.test(e.field));

  return (
    <>
      <Autocomplete
        multiple
        options={options}
        value={selected}
        getOptionLabel={(o) => o.label}
        getOptionDisabled={(o) => !o.sellable}
        isOptionEqualToValue={(a, b) => a.articleRef === b.articleRef}
        onChange={(_, next) => onChange(next.map((o) => o.articleRef))}
        renderOption={(props, o) => (
          <li {...props} key={o.articleRef}>
            <span>
              {o.label}
              <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block' }}>
                {o.sellable ? o.priceTypeLabel : `${o.priceTypeLabel} · ${o.reason}`}
              </Typography>
            </span>
          </li>
        )}
        renderInput={(params) => (
          <TextField {...params} size="small" label={label} placeholder={T.addOnsPlaceholder} helperText={problems.length ? undefined : helperText} error={problems.length > 0} />
        )}
      />
      {problems.map((p) => <Typography key={p.field} variant="body2" color="error" role="alert">{p.message}</Typography>)}
    </>
  );
}
