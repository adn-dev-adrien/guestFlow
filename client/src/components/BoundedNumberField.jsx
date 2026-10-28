/**
 * BoundedNumberField — a number input for a bound the server enforces
 * (specs/settings-input-guards.md rules 1-7). It holds a local draft and tells the parent only when
 * the operator leaves the field or presses Enter — never per keystroke.
 *
 * - A minus sign never reaches the field when `limits.min >= 0` (removed as typed or pasted, the caret
 *   stays in place); the helper reads « Positif uniquement. » for 2 s.
 * - A text that is not a number (or an empty required field) restores the last committed value and
 *   the helper reads « Nombre attendu. » for 2 s. Escape restores it too.
 * - A number outside the bounds, or a decimal in a whole-number field, is REFUSED, never clamped: it is
 *   committed as typed and the field turns red with the limit, so the form cannot be saved with it.
 * - ArrowUp / ArrowDown step by 1 (or 10^-decimals) and stop at the bounds.
 * - French and English decimal separators are both read.
 * The client never hardcodes a bound: `limits` comes from the server payload.
 *
 * Props:
 *   - value: number | ''           — the committed value (controlled by the parent form).
 *   - onCommit: (number | '') => void — blur / Enter / arrow keys only.
 *   - limits: { min, max, integer?, decimals?, unit?, message? } — the server's descriptor.
 *   - required?: boolean (default true) — an empty field restores the previous value; when false it
 *       commits ''.
 *   - error?: string               — a message from the server (shown in red, wins over the range check).
 *   - helperText?: node            — shown while nothing else needs saying.
 *   - showUnit?: boolean (default true) — the unit as an end adornment; off where a column header says it.
 *   - ...rest — forwarded to MUI <TextField> (label, size, fullWidth, disabled, sx…).
 *
 * The 2 s messages are also announced through a polite live region.
 *
 * It renders `type="text"` with a numeric `inputMode`, so there is no native spinner and no
 * browser-specific parsing; the unit sits as an end adornment.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, InputAdornment, TextField } from '@mui/material';
import { parseLocaleNumber, rangeError, stripMinus, toDisplay } from '../utils/numberInput';

const FLASH_MS = 2000;
const VISUALLY_HIDDEN = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

export default function BoundedNumberField({
  value,
  onCommit,
  limits,
  required = true,
  error = '',
  helperText = '',
  showUnit = true,
  slotProps,
  onKeyDown,
  ...rest
}) {
  const [draft, setDraft] = useState(toDisplay(value));
  const [focused, setFocused] = useState(false);
  const [flash, setFlash] = useState('');
  const inputRef = useRef(null);
  const caret = useRef(null);
  const timer = useRef(null);

  useEffect(() => { if (!focused) setDraft(toDisplay(value)); }, [value, focused]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (caret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const say = (message) => {
    setFlash(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(''), FLASH_MS);
  };

  const forbidsMinus = limits.min >= 0;
  const stepSize = limits.integer || !Number.isInteger(limits.decimals) ? 1 : 10 ** -limits.decimals;
  const stepped = (n) => (Number.isInteger(limits.decimals) ? Number(n.toFixed(limits.decimals)) : n);

  const change = (event) => {
    const typed = event.target.value;
    if (forbidsMinus && stripMinus(typed) !== typed) {
      const before = typed.slice(0, event.target.selectionStart || 0);
      caret.current = stripMinus(before).length;
      setDraft(stripMinus(typed));
      say('Positif uniquement.');
      return;
    }
    setDraft(typed);
  };

  const commit = () => {
    const text = draft.trim();
    if (text === '' && !required) {
      onCommit('');
      return;
    }
    const parsed = parseLocaleNumber(text);
    if (Number.isNaN(parsed)) {
      setDraft(toDisplay(value));
      say('Nombre attendu.');
      return;
    }
    setDraft(toDisplay(parsed));
    onCommit(parsed);
  };

  // Steps from what is typed when it is a number, else from the committed value. From inside the bounds it
  // stops at them; from a refused value outside them it only moves one step (never snapped, rule 5).
  const step = (direction) => {
    const typed = parseLocaleNumber(draft);
    const committed = Number(value);
    const start = !Number.isNaN(typed) ? typed : (Number.isFinite(committed) ? committed : limits.min);
    const inside = start >= limits.min && start <= limits.max;
    if (direction > 0 ? start >= limits.max : start <= limits.min) return;
    const raw = stepped(start + direction * stepSize);
    const next = inside ? Math.min(limits.max, Math.max(limits.min, raw)) : raw;
    setDraft(toDisplay(next));
    onCommit(next);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    else if (event.key === 'Escape') { setDraft(toDisplay(value)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); step(-1); }
    if (onKeyDown) onKeyDown(event);
  };

  const refusal = error || rangeError(value, limits);
  const shownHelper = refusal || flash || helperText;

  return (
    <>
      <TextField
        {...rest}
        inputRef={inputRef}
        type="text"
        value={focused ? draft : toDisplay(value)}
        onChange={change}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={handleKeyDown}
        error={Boolean(refusal)}
        color={flash && !refusal ? 'warning' : undefined}
        focused={flash && !refusal ? true : undefined}
        helperText={shownHelper || undefined}
        sx={{ '& fieldset': { transition: 'border-color 160ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }, ...rest.sx }}
        slotProps={{
          ...slotProps,
          htmlInput: { inputMode: limits.integer ? 'numeric' : 'decimal', 'aria-invalid': Boolean(refusal), ...slotProps?.htmlInput },
          input: {
            ...slotProps?.input,
            endAdornment: showUnit && limits.unit ? <InputAdornment position="end">{limits.unit}</InputAdornment> : slotProps?.input?.endAdornment,
          },
        }}
      />
      <Box component="span" role="status" aria-live="polite" sx={VISUALLY_HIDDEN}>{flash}</Box>
    </>
  );
}
