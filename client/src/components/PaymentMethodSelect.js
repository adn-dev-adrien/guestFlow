import React from 'react';
import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';

/**
 * PaymentMethodSelect — a Select bound to the direct-reservation payment-method catalogue.
 * specs/direct-payment-method-commission.md §4.2.
 *
 * Props:
 *  - value: number | null            currently-selected method id (null → falls back to defaultId)
 *  - onChange: (id: number) => void  called with the chosen method id
 *  - methods: Array<{ id, name, commissionPercent, commissionFixed, isActive }>  catalogue (active + selected)
 *  - defaultId: number | null        id used for display when value is null
 *  - label, size, fullWidth, disabled: standard MUI passthroughs
 *  - showRate: boolean               append « (1,5 %) » to each option label (default true)
 *
 * Renders active methods as options; a selected-but-deactivated method still shows (greyed, suffixed
 * « (inactif) ») so historical reservations keep displaying their method until the operator changes it.
 */
export default function PaymentMethodSelect({
  value, onChange, methods = [], defaultId = null,
  label = 'Moyen de paiement', size = 'small', fullWidth = true, disabled = false, showRate = true,
}) {
  const effective = value ?? defaultId ?? '';
  const options = methods.filter((m) => Number(m.isActive) === 1 || m.id === effective);
  const fmtRate = (m) => {
    if (!showRate) return '';
    const r = Number(m.commissionPercent) || 0;
    const f = Number(m.commissionFixed) || 0;
    const parts = [`${r.toFixed(2).replace('.', ',')} %`];
    if (f > 0) parts.push(`${f.toFixed(2).replace('.', ',')} €`);
    return ` (${parts.join(' + ')})`;
  };
  return (
    <FormControl fullWidth={fullWidth} size={size} disabled={disabled}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={effective === '' ? '' : effective}
        label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.name}{fmtRate(m)}{Number(m.isActive) === 1 ? '' : ' (inactif)'}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
