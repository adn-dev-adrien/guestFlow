/**
 * RelativeDayField — « Envoyé [2] jours [avant ▾] l'arrivée » as one sentence
 * (specs/guest-email-texts-made-simple.md rule 43 — UI/UX review 2026-10-18, decision 11). Generic: any
 * moment counted in days from an anchor the server names.
 *
 * It holds no rule: what was typed goes to `onChange` as it is, and the server answers the signed
 * offset, the refusal (`error`) and the example day (`example`).
 *
 * Props:
 *   label          string — above the sentence (« Quand »)
 *   days           string — the number as typed
 *   direction      'before' | 'after' | 'same'
 *   anchorLabel    string — « l'arrivée », « l'échéance du solde »… (from the server)
 *   onChange       ({ days, direction }) => void
 *   error          string — under the number, the field is marked
 *   example        string — under the sentence (« Prochain séjour … : envoyé le mercredi 21 octobre. »)
 *   disabled
 */
import React from 'react';
import { Box, FormHelperText, MenuItem, Stack, TextField, Typography } from '@mui/material';

const DIRECTIONS = [
  { value: 'before', label: 'avant' },
  { value: 'after', label: 'après' },
  { value: 'same', label: 'le jour même de' },
];

export default function RelativeDayField({ label = 'Quand', days, direction, anchorLabel, onChange, error, example, disabled = false }) {
  const same = direction === 'same';
  const plural = String(days).trim() === '1' ? 'jour' : 'jours';
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography>Envoyé</Typography>
        {!same && (
          <>
            <TextField
              size="small"
              value={days}
              onChange={(e) => onChange({ days: e.target.value, direction })}
              error={Boolean(error)}
              disabled={disabled}
              sx={{ width: 76 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Nombre de jours', 'aria-invalid': Boolean(error), 'aria-describedby': error ? 'relative-day-error' : undefined } }}
            />
            <Typography>{plural}</Typography>
          </>
        )}
        <TextField
          select
          size="small"
          value={direction}
          onChange={(e) => onChange({ days, direction: e.target.value })}
          disabled={disabled}
          slotProps={{ htmlInput: { 'aria-label': 'Avant ou après' } }}
          sx={{ minWidth: 120 }}
        >
          {DIRECTIONS.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
        </TextField>
        <Typography>{anchorLabel}</Typography>
      </Stack>
      {error && <FormHelperText id="relative-day-error" error role="alert">{error}</FormHelperText>}
      {!error && example && <FormHelperText>{example}</FormHelperText>}
    </Box>
  );
}
