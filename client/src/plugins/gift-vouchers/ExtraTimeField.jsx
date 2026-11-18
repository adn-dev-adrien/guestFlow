/**
 * ExtraTimeField — « Temps en plus » offered with a composed voucher (specs/gift-voucher-campaigns.md rule 4): offered or not, and the most that can be added, in
 * steps of the band's slot. The server judges the value; its refusal is shown under the field.
 *
 * Props: value (minutes, 0 = not offered), onChange(minutes), step (the slot's minutes), error?, offeredLabel, maxLabel
 */
import React from 'react';
import { FormControlLabel, Stack, Switch } from '@mui/material';
import { QuantityField } from '../sdk';

export default function ExtraTimeField({
  value, onChange, step, error = null, offeredLabel, maxLabel,
}) {
  const offered = Number(value) > 0;
  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        control={<Switch checked={offered} onChange={(e) => onChange(e.target.checked ? step : 0)} />}
        label={offeredLabel}
      />
      {offered ? (
        <QuantityField
          label={maxLabel} value={value} step={step} min={0} size="small" onCommit={onChange} error={Boolean(error)} helperText={error || undefined} sx={{ maxWidth: 260 }}
        />
      ) : null}
    </Stack>
  );
}
