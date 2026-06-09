import React from 'react';
import {
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput,
} from '@mui/material';

/**
 * Multi-select of properties with a "Tous les logements" sentinel, shared by the Options and
 * Resources forms.
 *
 * Props:
 * - properties: [{ id, name }]
 * - value: number[] — selected property ids; an EMPTY array means "all properties" (global).
 * - onChange: (ids: number[]) => void — receives the normalized id array ([] = all).
 * - label?: string (default "Logements")
 */
export default function PropertiesMultiSelect({ properties = [], value, onChange, label = 'Logements' }) {
  const ids = Array.isArray(value) ? value : [];
  return (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={ids.length === 0 ? [-1] : ids}
        label={label}
        onChange={(e) => {
          let newVal = e.target.value;
          if (typeof newVal === 'string') newVal = newVal.split(',').map(Number);
          // Picking a real property alongside the "all" sentinel drops the sentinel.
          const normalized = newVal.includes(-1) && newVal.length > 1
            ? newVal.filter((v) => v !== -1)
            : newVal;
          if (normalized.includes(-1)) { onChange([]); return; }
          const allIds = properties.map((p) => p.id);
          const allSelected = allIds.length > 0 && allIds.every((id) => normalized.includes(id));
          onChange(allSelected ? [] : normalized);
        }}
        input={<OutlinedInput label={label} />}
        renderValue={(selected) => (!selected || selected.length === 0 || selected.includes(-1)
          ? 'Tous les logements'
          : selected.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', '))}
      >
        <MenuItem value={-1}>Tous les logements</MenuItem>
        {properties.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            <Checkbox checked={ids.includes(p.id)} />
            <ListItemText primary={p.name} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
