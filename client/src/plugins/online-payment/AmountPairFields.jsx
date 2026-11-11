/**
 * AmountPairFields — one amount field per (credit, receipt) pair, for a manual split or typed shares
 * (specs/reconciliation-assisted-matching.md rules 7, 18). The server's refusal of a pair shows under its
 * field; what is not an amount (comma or dot, two decimals at most) is refused here, with no request.
 *
 * Props: pairs[{ id, label, text }], onChange(index, text), refusalFor(index) → { message } | null
 */
import React from 'react';
import { Stack, TextField } from '@mui/material';
import { parseEuroInput } from './reconciliationShared';

export const INVALID_AMOUNT = 'Montant invalide : chiffres et virgule, deux décimales au plus.';

export default function AmountPairFields({ pairs, onChange, refusalFor }) {
  return (
    <Stack gap={1} sx={{ mt: 1 }}>
      {pairs.map((pair, index) => {
        const refusal = refusalFor ? refusalFor(index) : null;
        const local = parseEuroInput(pair.text) == null ? INVALID_AMOUNT : '';
        return (
          <TextField
            key={pair.id} size="small" fullWidth label={`${pair.label} (€)`} value={pair.text} onChange={(e) => onChange(index, e.target.value)}
            error={Boolean(local || refusal)} helperText={local || (refusal && refusal.message) || ' '}
            slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontSize: 16 } } }}
          />
        );
      })}
    </Stack>
  );
}
