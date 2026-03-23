import React, { useState, useEffect } from 'react';
import { TextField } from '@mui/material';

// Convert ISO (YYYY-MM-DD) to French (DD/MM/YYYY)
function isoToFr(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Convert French (DD/MM/YYYY) to ISO (YYYY-MM-DD)
function frToIso(fr) {
  if (!fr) return '';
  const [d, m, y] = fr.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Validate DD/MM/YYYY format
function isValidFrDate(str) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return false;
  const [d, m, y] = str.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export default function DateInput({ value, onChange, label, ...props }) {
  const [display, setDisplay] = useState(isoToFr(value));

  useEffect(() => {
    setDisplay(isoToFr(value));
  }, [value]);

  const handleChange = (e) => {
    let raw = e.target.value;
    // Auto-insert slashes
    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length <= 2) raw = digits;
    else if (digits.length <= 4) raw = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    else raw = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;

    setDisplay(raw);

    if (isValidFrDate(raw)) {
      onChange(frToIso(raw));
    } else if (raw === '') {
      onChange('');
    }
  };

  const handleBlur = () => {
    // On blur, reset display to match the current value
    setDisplay(isoToFr(value));
  };

  return (
    <TextField
      {...props}
      label={label}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder="JJ/MM/AAAA"
      InputLabelProps={{ shrink: true }}
      inputProps={{ maxLength: 10, ...props.inputProps }}
    />
  );
}
