/**
 * PeriodSelector — pick the window a page reads: the whole exercise, one of its months, or a custom
 * du / au (specs/finance-dashboard-redesign.md rules 1-2). Generic: any page scoped by an exercise
 * (tourist tax, accounting) can reuse it.
 *
 * A custom window whose start is after its end, with a missing date or one that is not a real day (a 5-digit year), wider than MAX_CUSTOM_WINDOW_DAYS
 * or ending past the date horizon (rule 51), is refused right here with the same message the server
 * gives: the page keeps its previous window until both dates are valid.
 *
 * Optional quarter and year kinds (specs/tourist-tax-report-v2.md rule 18): pass `kinds` to choose and order the
 * segments, and the server's `quarters` / `years` options. Without `kinds` the selector is the exercise one above.
 *
 * Props:
 *   kind:      'fy' | 'month' | 'quarter' | 'year' | 'custom'
 *   kinds?:    Array<kind>                    segments shown, in order (default ['fy', 'month', 'custom'])
 *   quarter?:  'YYYY-Qn', year?: 'YYYY'       selected quarter / year
 *   quarters?, years?: Array<{ value, label }> their options, from the server
 *   month:     'YYYY-MM'                      selected month (kind 'month')
 *   from, to:  'YYYY-MM-DD'                   custom bounds (kind 'custom')
 *   months:    Array<{ month, label }>        the exercise's months, from the server
 *   onChange:  ({ kind, month?, from?, to? }) => void — only called with a valid window
 *   labels?:   { fy, month, custom }          segment labels (French defaults)
 *   today?:    'YYYY-MM-DD'                   the day the window is judged from: the server's when the page
 *                                             knows it (`useServerToday`), the device's by default
 */
import React, { useEffect, useState } from 'react';
import { Box, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { HORIZON_MESSAGE, PAST_HORIZON_MESSAGE } from '../constants/dateHorizon';
import { dateWindowMessage } from '../utils/dateHorizon';
import { isRealIsoDay, localIsoToday } from '../utils/isoDay';

const DEFAULT_LABELS = { fy: 'Exercice', month: 'Mois', custom: 'Personnalisée' };
const DEFAULT_KINDS = ['fy', 'month', 'custom'];
export const MAX_CUSTOM_WINDOW_DAYS = 750;
export const PERIOD_MESSAGES = {
  missingDates: 'Deux dates à choisir.',
  reversed: 'La date de début doit précéder la date de fin.',
  tooWide: `Période trop longue : ${MAX_CUSTOM_WINDOW_DAYS} jours au plus.`,
  tooFar: HORIZON_MESSAGE,
  tooOld: PAST_HORIZON_MESSAGE,
};

const DAY_MS = 86400000;

export function customWindowError(from, to, today = localIsoToday()) {
  if (!isRealIsoDay(from) || !isRealIsoDay(to)) return PERIOD_MESSAGES.missingDates;
  if (from > to) return PERIOD_MESSAGES.reversed;
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS > MAX_CUSTOM_WINDOW_DAYS) return PERIOD_MESSAGES.tooWide;
  return dateWindowMessage(from, today) || dateWindowMessage(to, today);
}

export default function PeriodSelector({
  kind, month, from, to, months = [], onChange, labels = DEFAULT_LABELS, today = localIsoToday(),
  kinds = DEFAULT_KINDS, quarter, year, quarters = [], years = [],
}) {
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => { setDraft({ from, to }); }, [from, to]);
  const error = kind === 'custom' ? customWindowError(draft.from, draft.to, today) : '';

  const setCustom = (next) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    if (!customWindowError(merged.from, merged.to, today)) onChange({ kind: 'custom', from: merged.from, to: merged.to });
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
          if (next === 'custom') onChange({ kind: 'custom', from: draft.from, to: draft.to });
          else if (next === 'quarter') onChange({ kind: 'quarter', quarter: quarter || quarters[0]?.value });
          else if (next === 'year') onChange({ kind: 'year', year: year || years[0]?.value });
          else onChange({ kind: next, month });
        }}
        sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, minHeight: 36, '@media (pointer: coarse)': { minHeight: 44 } } }}
      >
        {kinds.map((k) => <ToggleButton key={k} value={k}>{labels[k]}</ToggleButton>)}
      </ToggleButtonGroup>
      {kind === 'month' && (
        <TextField select size="small" label="Mois" value={month || ''} onChange={(e) => onChange({ kind: 'month', month: e.target.value })} sx={{ minWidth: 170 }}>
          {months.map((m) => <MenuItem key={m.month} value={m.month} sx={{ textTransform: 'capitalize' }}>{m.label}</MenuItem>)}
        </TextField>
      )}
      {kind === 'quarter' && (
        <TextField select size="small" label={labels.quarter} value={quarter || ''} onChange={(e) => onChange({ kind: 'quarter', quarter: e.target.value })} sx={{ minWidth: 190 }}>
          {quarters.map((q) => <MenuItem key={q.value} value={q.value}>{q.label}</MenuItem>)}
        </TextField>
      )}
      {kind === 'year' && (
        <TextField select size="small" label={labels.year} value={year || ''} onChange={(e) => onChange({ kind: 'year', year: e.target.value })} sx={{ minWidth: 120 }}>
          {years.map((y) => <MenuItem key={y.value} value={y.value}>{y.label}</MenuItem>)}
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
