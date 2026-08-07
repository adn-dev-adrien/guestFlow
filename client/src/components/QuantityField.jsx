/**
 * QuantityField — a controlled numeric input with `−` / `＋` stepper buttons.
 *
 * Solves two problems the raw `<TextField type="number">` has on the reservation fiche
 * (specs/reservation-quantity-stepper.md):
 *   1. A local draft decouples typing from committing, so the field can be momentarily empty while
 *      the operator retypes a value — the parent is NOT notified per keystroke, only on blur / Enter
 *      / stepper click. This stops a mid-edit `0` from reaching setters that drop the line at `≤ 0`.
 *   2. Tappable `−` / `＋` buttons work on mobile, where native number spinners never render.
 *
 * The value is a UX-only mirror: authoritative clamping/normalization stays on the server and in the
 * form setters. This component only holds local UI state and clamps for ergonomics.
 *
 * Props:
 *   - value: number | ''            — the committed value (controlled by the parent form).
 *   - onCommit: (number | '') => void — called on blur / Enter / stepper with the clamped value
 *       (or '' only when allowEmpty is true and the field is cleared). NOT called per keystroke.
 *   - min?: number (default 0)       — lower clamp bound; also the fallback when a non-empty field is
 *       cleared and allowEmpty is false.
 *   - max?: number                   — optional upper clamp bound; disables `＋` when reached.
 *   - step?: number (default 1)      — stepper / ArrowUp-Down increment. A fractional step switches the
 *       mobile keyboard to `decimal`.
 *   - allowEmpty?: boolean (default false) — when true, a cleared field commits '' and displays blank;
 *       when false, a cleared field falls back to `min` (never emits 0/'' → never deselects an option).
 *   - decrementLabel? / incrementLabel? — French aria/tooltip text (defaults « Diminuer » / « Augmenter »).
 *   - ...rest — forwarded to MUI <TextField> (label, error, helperText, disabled, size, fullWidth, sx…).
 *
 * It renders `type="text"` (not `number`) so the native spinner is suppressed and formatting is fully
 * controlled; `inputMode` still surfaces the numeric keypad on mobile.
 */
import React, { useEffect, useState } from 'react';
import { TextField, IconButton, InputAdornment, Tooltip } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';

const clamp = (n, min, max) => {
  let v = Math.max(min, n);
  if (max != null) v = Math.min(max, v);
  return v;
};

function toDisplay(value, allowEmpty) {
  if (value === '' || value == null) return allowEmpty ? '' : '';
  return String(Number(value));
}

export default function QuantityField({
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  allowEmpty = false,
  decrementLabel = 'Diminuer',
  incrementLabel = 'Augmenter',
  disabled = false,
  ...rest
}) {
  const [draft, setDraft] = useState(toDisplay(value, allowEmpty));
  const [focused, setFocused] = useState(false);

  // Resync the draft with the committed value whenever the field is idle (parent recomputed, the
  // stepper committed, or a reservation loaded).
  useEffect(() => {
    if (!focused) setDraft(toDisplay(value, allowEmpty));
  }, [value, focused, allowEmpty]);

  const commit = () => {
    const raw = draft.trim().replace(',', '.');
    if (raw === '') {
      if (allowEmpty) { onCommit(''); return; }
      onCommit(min);
      setDraft(String(min));
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(toDisplay(value, allowEmpty)); // invalid → revert to last committed value
      return;
    }
    const next = clamp(parsed, min, max);
    onCommit(next);
    setDraft(String(next));
  };

  const stepBy = (delta) => {
    if (disabled) return;
    const base = value === '' || value == null ? min : Number(value);
    onCommit(clamp(base + delta * step, min, max));
  };

  const numericValue = value === '' || value == null ? min : Number(value);
  const atMin = numericValue <= min;
  const atMax = max != null && numericValue >= max;

  return (
    <TextField
      {...rest}
      type="text"
      inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
      disabled={disabled}
      value={focused ? draft : toDisplay(value, allowEmpty)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
        if (rest.onKeyDown) rest.onKeyDown(e);
      }}
      slotProps={{
        ...rest.slotProps,
        htmlInput: {
          ...rest.slotProps?.htmlInput,
          style: { textAlign: 'center', ...rest.slotProps?.htmlInput?.style },
        },
        input: {
          ...rest.slotProps?.input,
          startAdornment: (
            <InputAdornment position="start">
              <Tooltip title={decrementLabel}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={decrementLabel}
                    onClick={() => stepBy(-1)}
                    disabled={disabled || atMin}
                    sx={{ minWidth: 44, minHeight: 44 }}
                  >
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={incrementLabel}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={incrementLabel}
                    onClick={() => stepBy(1)}
                    disabled={disabled || atMax}
                    sx={{ minWidth: 44, minHeight: 44 }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
