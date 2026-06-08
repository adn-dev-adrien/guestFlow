/**
 * ArithmeticTextField — a money TextField that accepts arithmetic expressions.
 *
 * The operator types e.g. `100+20` (or `(100+20)*2`, French comma OK) and on **Enter** or **blur**
 * the expression is evaluated and the numeric result committed (rounded to 2 decimals, clamped to
 * ≥0 by default). While typing, the raw text is shown untouched; an invalid/incomplete expression
 * on commit silently reverts to the last committed value. Specs/reservation-price-arithmetic.md.
 *
 * Props:
 *   - value: number | '' | null  — the committed numeric value (controlled by the parent form).
 *   - onCommit: (number | '') => void — called on Enter/blur with the evaluated value, or '' when
 *       the field is cleared. NOT called on every keystroke.
 *   - nonNegative?: boolean (default true) — clamp the result to ≥0.
 *   - ...rest — forwarded to MUI <TextField> (label, size, error, helperText, sx, fullWidth, slotProps…).
 *
 * It deliberately renders a text input (not type="number") so `+ - * / ( )` can be typed.
 */
import React, { useEffect, useState } from 'react';
import { TextField } from '@mui/material';
import { evaluateArithmetic } from '../utils/arithmetic';

function toDisplay(value) {
  if (value === '' || value == null) return '';
  return String(value);
}

export default function ArithmeticTextField({ value, onCommit, nonNegative = true, ...rest }) {
  const [draft, setDraft] = useState(toDisplay(value));
  const [focused, setFocused] = useState(false);

  // Keep the draft in sync with the committed value when the field is not being edited (e.g. the
  // engine recomputed the price, or the form loaded a reservation).
  useEffect(() => {
    if (!focused) setDraft(toDisplay(value));
  }, [value, focused]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === '') {
      onCommit('');
      return;
    }
    const result = evaluateArithmetic(raw);
    if (result == null || !Number.isFinite(result)) {
      setDraft(toDisplay(value)); // invalid → revert to last committed value
      return;
    }
    let rounded = Math.round(result * 100) / 100;
    if (nonNegative) rounded = Math.max(0, rounded);
    onCommit(rounded);
    setDraft(String(rounded));
  };

  return (
    <TextField
      {...rest}
      type="text"
      inputMode="decimal"
      value={focused ? draft : toDisplay(value)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (rest.onKeyDown) rest.onKeyDown(e);
      }}
    />
  );
}
