/**
 * TypedCountField — the stepper of a number the operator types (people served, nights), which turns
 * red when the party or the stay changed under it and offers to apply the new value
 * (specs/non-card-option-served-persons.md rules 20 and 26).
 *
 * Props: label, value, min, max, onCommit(number), disabled, helperText, sx, plus
 *   - alert: { label, applyLabel } | null — from the quote's `typedCountAlerts`; the server decides.
 *   - onApply: () => void — circular-arrows button, shown only with an alert.
 */
import React from 'react';
import { IconButton, Stack, Tooltip } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import QuantityField from '../QuantityField';

export default function TypedCountField({
  label, value, min, max, onCommit, disabled, helperText, sx, alert, onApply,
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', width: { xs: '100%', sm: 'auto' } }}>
      <QuantityField
        size="small"
        label={label}
        min={min}
        max={max}
        value={value}
        onCommit={onCommit}
        disabled={disabled}
        error={Boolean(alert)}
        helperText={alert ? alert.label : helperText}
        sx={{ flex: { xs: 1, sm: 'none' }, ...sx }}
      />
      {alert && (
        <Tooltip title={alert.applyLabel}>
          <span>
            <IconButton
              aria-label={alert.applyLabel}
              color="error"
              disabled={disabled}
              onClick={onApply}
              sx={{ minWidth: 44, minHeight: 44, border: 1, borderColor: 'error.main', borderRadius: 1 }}
            >
              <SyncIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  );
}
