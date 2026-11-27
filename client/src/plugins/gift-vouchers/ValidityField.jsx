/**
 * ValidityField — the validity of a voucher, picked from the short list the server accepts (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 13):
 * 3, 6, 12, 18 or 24 months. Used by the campaign editor, « Nouveau bon » and « Sur mesure ». The server judges the value; its sentence is drawn under the field.
 * Props: value (months, number or text), onChange(months as text), label, error.
 */
import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import { VALIDITY_CHOICES } from './giftVoucherTexts';

export default function ValidityField({
  value, onChange, label, error, ...rest
}) {
  return (
    <TextField select label={label} value={String(value)} onChange={(e) => onChange(e.target.value)} size="small" fullWidth error={Boolean(error)} helperText={error} {...rest}>
      {VALIDITY_CHOICES.map((months) => <MenuItem key={months} value={String(months)}>{`${months} mois`}</MenuItem>)}
    </TextField>
  );
}
