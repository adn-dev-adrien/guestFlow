/**
 * SynthesisPeriodBar — the period of the accounting synthesis (specs/accounting-synthesis.md rules 1, 22, 24):
 * Mois · Trimestre · Exercice · Personnalisée, then the month, quarter or exercise the server offers, or a
 * du / au. Feature-local: the options come from the synthesis payload. A custom window the server would
 * refuse is refused here with the same message, judged from the server's day, and sends nothing.
 *
 * Props:
 *   window:    the payload's `window` (what is shown), or null while nothing is loaded
 *   options:   the payload's `periodOptions` + `fiscalYears`, or null
 *   today:     'YYYY-MM-DD' — the server's day
 *   onChange:  ({ period, month?, quarter?, fiscalYear?, from?, to? }) => void
 */
import React, { useEffect, useState } from 'react';
import { Box, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DateField, customWindowError } from '../sdk';
import { PERIOD_KINDS } from './synthesisCopy';

const TOGGLE_SX = {
  flexWrap: 'wrap',
  '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5, minHeight: 36, '@media (pointer: coarse)': { minHeight: 44 } },
};

export default function SynthesisPeriodBar({ window: win, options, today, onChange }) {
  const kind = win ? win.kind : 'month';
  const [draft, setDraft] = useState({ from: win?.from || '', to: win?.to || '' });
  const [customOpen, setCustomOpen] = useState(kind === 'custom');
  useEffect(() => {
    if (win) setDraft({ from: win.from, to: win.to });
    if (win && win.kind === 'custom') setCustomOpen(true);
  }, [win?.from, win?.to, win?.kind]);

  const shownKind = customOpen ? 'custom' : kind;
  const error = shownKind === 'custom' ? customWindowError(draft.from, draft.to, today || undefined) : '';

  const setCustom = (next) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    if (!customWindowError(merged.from, merged.to, today || undefined)) onChange({ period: 'custom', from: merged.from, to: merged.to });
  };

  const pick = (picked) => {
    // An exclusive toggle sends null when the shown kind is pressed again. With figures shown that changes nothing
    // (rule 49, V2-4: a stray tap keeps the chosen period); on a refused first load (no window) it loads that kind's
    // default, so a refusal is one click from a working period (rule 41).
    if (!picked && win) return;
    const next = picked || shownKind;
    if (next === 'custom') {
      setCustomOpen(true);
      if (!customWindowError(draft.from, draft.to, today || undefined)) onChange({ period: 'custom', from: draft.from, to: draft.to });
      return;
    }
    setCustomOpen(false);
    onChange({ period: next });
  };

  const months = options?.months || [];
  const quarters = options?.quarters || [];
  const years = options?.fiscalYears || [];

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <ToggleButtonGroup exclusive size="small" value={shownKind} aria-label="Période" onChange={(_, next) => pick(next)} sx={TOGGLE_SX}>
        {PERIOD_KINDS.map((k) => <ToggleButton key={k.value} value={k.value}>{k.label}</ToggleButton>)}
      </ToggleButtonGroup>
      {shownKind === 'month' && win && (
        <TextField select size="small" label="Mois" value={win.month || ''} onChange={(e) => onChange({ period: 'month', month: e.target.value })} sx={{ minWidth: 170, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}>
          {months.map((m) => <MenuItem key={m.value} value={m.value} sx={{ textTransform: 'capitalize' }}>{m.label}</MenuItem>)}
        </TextField>
      )}
      {shownKind === 'quarter' && win && (
        <TextField select size="small" label="Trimestre" value={win.quarter || ''} onChange={(e) => onChange({ period: 'quarter', quarter: e.target.value })} sx={{ minWidth: 140, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}>
          {quarters.map((q) => <MenuItem key={q.value} value={q.value}>{q.label}</MenuItem>)}
        </TextField>
      )}
      {shownKind === 'fy' && win && (
        <TextField select size="small" label="Exercice" value={win.fiscalYear ?? ''} onChange={(e) => onChange({ period: 'fy', fiscalYear: e.target.value })} sx={{ minWidth: 150, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}>
          {years.map((y) => <MenuItem key={y.key} value={y.key}>{y.label}</MenuItem>)}
        </TextField>
      )}
      {shownKind === 'custom' && (
        <>
          <DateField size="small" label="Du" value={draft.from || ''} onChange={(e) => setCustom({ from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} error={Boolean(error)} sx={{ flex: { xs: '1 1 40%', sm: '0 0 auto' } }} />
          <DateField size="small" label="Au" value={draft.to || ''} onChange={(e) => setCustom({ to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} error={Boolean(error)} sx={{ flex: { xs: '1 1 40%', sm: '0 0 auto' } }} />
          {error && <Typography variant="caption" color="error" role="alert" sx={{ width: { xs: '100%', sm: 'auto' } }}>{error}</Typography>}
        </>
      )}
    </Box>
  );
}
