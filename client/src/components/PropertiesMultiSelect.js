import React from 'react';
import {
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput,
} from '@mui/material';

/**
 * Multi-select of properties, shared by the Options and Resources forms.
 *
 * Two contracts, picked by `emptyMeansNone`:
 *
 * - **Default (resources)** — an EMPTY array means « Tous les logements » (global). Selecting every
 *   property collapses back to `[]`. A `-1` sentinel row represents the global state in the menu.
 *
 * - **`emptyMeansNone` (options, specs/option-property-scope.md)** — the scope is EXPLICIT: « Tous les
 *   logements » stores **every current property id**; a specific subset stores those ids; an EMPTY array
 *   means **« Aucun logement »** (available nowhere). No `-1` sentinel — « Tous » is just "all ids".
 *
 * Props:
 * - properties: [{ id, name }]
 * - value: number[] — selected property ids (semantics per `emptyMeansNone`).
 * - onChange: (ids: number[]) => void
 * - label?: string (default "Logements")
 * - emptyMeansNone?: boolean (default false)
 */
export default function PropertiesMultiSelect({ properties = [], value, onChange, label = 'Logements', emptyMeansNone = false }) {
  const ids = Array.isArray(value) ? value : [];
  const allIds = properties.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => ids.includes(id));

  if (emptyMeansNone) {
    // Explicit scope: « Tous » = all current ids; [] = none. No sentinel collapse.
    return (
      <FormControl fullWidth>
        <InputLabel>{label}</InputLabel>
        <Select
          multiple
          value={ids}
          label={label}
          displayEmpty
          onChange={(e) => {
            let next = e.target.value;
            if (typeof next === 'string') next = next.split(',').map(Number);
            if (next.includes(-1)) {
              // « Tous les logements » toggled: select all if not already all, else clear to none.
              onChange(allSelected ? [] : [...allIds]);
              return;
            }
            onChange(next);
          }}
          input={<OutlinedInput label={label} />}
          renderValue={(selected) => {
            if (!selected || selected.length === 0) return 'Aucun logement';
            if (allSelected) return 'Tous les logements';
            return selected.map((pid) => properties.find((p) => p.id === pid)?.name || pid).join(', ');
          }}
        >
          <MenuItem value={-1}>
            <Checkbox checked={allSelected} indeterminate={!allSelected && ids.length > 0} />
            <ListItemText primary="Tous les logements" />
          </MenuItem>
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

  // Legacy contract (resources): empty = all.
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
          const everySelected = allIds.length > 0 && allIds.every((id) => normalized.includes(id));
          onChange(everySelected ? [] : normalized);
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
