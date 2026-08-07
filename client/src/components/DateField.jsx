import React from 'react';
import { TextField } from '@mui/material';

/**
 * DateField — a native date input (`<input type="date">`) that auto-closes the browser calendar as soon
 * as a date is picked. It blurs the field right after a change so a single click selects the date AND
 * dismisses the calendar (some browsers / OSes otherwise leave the picker open).
 *
 * Props: identical to MUI `TextField` (the caller's `onChange` still fires first, with the same event).
 * `type="date"` is forced.
 */
export default function DateField({ onChange, ...props }) {
  const handleChange = (event) => {
    if (onChange) onChange(event);
    // Close the native date picker immediately after a selection.
    if (event.target && typeof event.target.blur === 'function') event.target.blur();
  };
  return <TextField {...props} type="date" onChange={handleChange} />;
}
