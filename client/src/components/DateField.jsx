import React, { useRef, useState } from 'react';
import { TextField } from '@mui/material';

// A change this soon after a key press on the field was typed, not picked in the calendar.
const KEYBOARD_CHANGE_MS = 500;

/**
 * DateField — a native date input (`<input type="date">`) that auto-closes the browser calendar as soon
 * as a date is picked, and lets a date be typed on the keyboard.
 *
 * - A calendar pick blurs the field, so a single click selects the date AND dismisses the calendar (some
 *   browsers / OSes otherwise leave the picker open).
 * - A change typed on the keyboard keeps the focus: Chromium fires a change on every digit once the date
 *   is complete (2 → 0002, 20 → 0020…), and a blur there would end the typing after the first digit.
 * - While typing, the `min` / `max` given in `slotProps.htmlInput` stay those of the first key press until
 *   the field loses the focus: Chromium drops a half-typed date when a bound moves, and callers often
 *   derive a bound from the value being typed.
 *
 * Props: identical to MUI `TextField` (the caller's `onChange`, `onKeyDown`, `onPointerDown` and `onBlur`
 * still fire, with the same event). `type="date"` is forced.
 */
export default function DateField({ onChange, onKeyDown, onPointerDown, onBlur, slotProps, ...props }) {
  const lastKeyAt = useRef(null);
  const [typingBounds, setTypingBounds] = useState(null);
  const htmlInput = slotProps?.htmlInput;

  const handleKeyDown = (event) => {
    lastKeyAt.current = Date.now();
    if (!typingBounds) setTypingBounds({ min: htmlInput?.min, max: htmlInput?.max });
    if (onKeyDown) onKeyDown(event);
  };
  const handlePointerDown = (event) => {
    lastKeyAt.current = null;
    if (onPointerDown) onPointerDown(event);
  };
  const handleBlur = (event) => {
    lastKeyAt.current = null;
    setTypingBounds(null);
    if (onBlur) onBlur(event);
  };
  const handleChange = (event) => {
    if (onChange) onChange(event);
    const typed = lastKeyAt.current !== null && Date.now() - lastKeyAt.current < KEYBOARD_CHANGE_MS;
    if (!typed && event.target && typeof event.target.blur === 'function') event.target.blur();
  };

  const effectiveSlotProps = typingBounds && htmlInput && typeof htmlInput === 'object'
    ? { ...slotProps, htmlInput: { ...htmlInput, min: typingBounds.min, max: typingBounds.max } }
    : slotProps;

  return (
    <TextField
      {...props}
      slotProps={effectiveSlotProps}
      type="date"
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onBlur={handleBlur}
    />
  );
}
