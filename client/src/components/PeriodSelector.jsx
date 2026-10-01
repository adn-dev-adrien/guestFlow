/**
 * PeriodSelector — pick the window a page reads: the whole exercise, one of its months, or a custom
 * du / au (specs/finance-dashboard-redesign.md rules 1-2). Generic: any page scoped by an exercise
 * (tourist tax, accounting) can reuse it.
 *
 * A custom window whose start is after its end, or with a missing date, is refused right here with
 * the same message the server gives: the page keeps its previous window until both dates are valid.
 *
 * Props:
 *   kind:      'fy' | 'month' | 'custom'
 *   month:     'YYYY-MM'                      selected month (kind 'month')
 *   from, to:  'YYYY-MM-DD'                   custom bounds (kind 'custom')
 *   months:    Array<{ month, label }>        the exercise's months, from the server
 *   onChange:  ({ kind, month?, from?, to? }) => void — only called with a valid window
 *   labels?:   { fy, month, custom }          segment labels (French defaults)
 */
import React, { useEffect, useState } from 'react';
import { Box, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

const DEFAULT_LABELS = { fy: 'Exercice', month: 'Mois', custom: 'Personnalisée' };
export const PERIOD_MESSAGES = {
  missingDates: 'Choisissez deux dates.',
  reversed: 'La date de début doit précéder la date de fin.',
};

export function customWindowError(from, to) {
  if (!from || !to) return PERIOD_MESSAGES.missingDates;
  if (from > to) return PERIOD_MESSAGES.reversed;
  return '';
}

export default function PeriodSelector({ kind, month, from, to, months = [], onChange, labels = DEFAULT_LABELS }) {
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => { setDraft({ from, to }); }, [from, to]);
  const error = kind === 'custom' ? customWindowError(draft.from, draft.to) : '';

  const setCustom = (next) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    if (!customWindowError(merged.from, merged.to)) onChange({ kind: 'custom', from: merged.from, to: merged.to });
  };

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={kind}
        aria-label="Période"
        onChange={(_, next) => {
          if (!next) return;
          onChange(next === 'custom' ? { kind: 'custom', from: draft.from, to: draft.to } : { kind: next, month });
        }}
        sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, minHeight: 36 } }}
      >
        <ToggleButton value="fy">{labels.fy}</ToggleButton>
        <ToggleButton value="month">{labels.month}</ToggleButton>
        <ToggleButton value="custom">{labels.custom}</ToggleButton>
      </ToggleButtonGroup>
      {kind === 'month' && (
        <TextField select size="small" label="Mois" value={month || ''} onChange={(e) => onChange({ kind: 'month', month: e.target.value })} sx={{ minWidth: 170 }}>
          {months.map((m) => <MenuItem key={m.month} value={m.month} sx={{ textTransform: 'capitalize' }}>{m.label}</MenuItem>)}
        </TextField>
      )}
      {kind === 'custom' && (
        <>
          <TextField size="small" type="date" label="Du" value={draft.from || ''} onChange={(e) => setCustom({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} error={Boolean(error)} />
          <TextField size="small" type="date" label="Au" value={draft.to || ''} onChange={(e) => setCustom({ to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} error={Boolean(error)} />
          {error && <Typography variant="caption" color="error" role="alert" sx={{ width: { xs: '100%', sm: 'auto' } }}>{error}</Typography>}
        </>
      )}
    </Box>
  );
}
