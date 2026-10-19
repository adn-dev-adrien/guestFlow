/**
 * SegmentedSelect — one choice among a few, shown as a segmented control while the options fit, as a
 * select past that (specs/ui-review-2026-10-19-operations.md rule 16). Full width on a phone either
 * way: a select squeezed into a corner reads « L… ».
 *
 * Props:
 *   label         string                         accessible name (« Logement »)
 *   options       Array<{ value, label }>        in display order
 *   value         any                            the selected option's value
 *   onChange      (value) => void
 *   maxSegments?  number   most options shown as segments (default 3)
 */
import React, { useId } from 'react';
import { ToggleButton, ToggleButtonGroup, FormControl, InputLabel, Select, MenuItem } from '@mui/material';

export default function SegmentedSelect({ label, options = [], value, onChange, maxSegments = 3 }) {
  const labelId = useId();
  if (options.length <= maxSegments) {
    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label={label}
        value={value}
        onChange={(_, next) => { if (next !== null && next !== undefined) onChange(next); }}
        sx={{
          width: { xs: '100%', sm: 'auto' },
          maxWidth: '100%',
          '& .MuiToggleButton-root': {
            flex: { xs: 1, sm: 'none' },
            minHeight: 44,
            px: 1.5,
            textTransform: 'none',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          },
          '& .MuiToggleButton-root.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText' },
          '& .MuiToggleButton-root.Mui-selected:hover': { bgcolor: 'primary.dark' },
        }}
      >
        {options.map((o) => (
          <ToggleButton key={String(o.value)} value={o.value} title={o.label}>{o.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    );
  }
  return (
    <FormControl size="small" sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: { sm: 220 }, maxWidth: { xs: '100%', sm: 360 } }}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select labelId={labelId} value={value} label={label} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <MenuItem key={String(o.value)} value={o.value}>{o.label}</MenuItem>)}
      </Select>
    </FormControl>
  );
}
