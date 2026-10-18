/**
 * MonthDayField — a day and a month without a year, for a date that comes back every year (a
 * season's opening, a closing day). Two Selects side by side; the value is « MM-DD », '' when unset.
 *
 * Props:
 *   label     string — above the pair
 *   value     'MM-DD' | ''
 *   onChange  (value: 'MM-DD' | '') => void — '' until both the day and the month are chosen
 *   error     string — under the pair
 *   disabled
 */
import React, { useEffect, useState } from 'react';
import { Box, FormControl, FormHelperText, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { MONTH_OPTIONS } from '../constants/months';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const pad = (n) => String(n).padStart(2, '0');
const split = (value) => {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? { month: Number(m[1]), day: Number(m[2]) } : { month: '', day: '' };
};

export default function MonthDayField({ label, value, onChange, error, disabled = false }) {
  const [parts, setParts] = useState(split(value));
  useEffect(() => { if (value) setParts(split(value)); }, [value]);

  const pick = (key) => (e) => {
    const next = { ...parts, [key]: e.target.value };
    setParts(next);
    onChange(next.day && next.month ? `${pad(next.month)}-${pad(next.day)}` : '');
  };
  const id = `md-${String(label).replace(/\W+/g, '-')}`;

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>{label}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0, 1fr)', gap: 1 }}>
        <FormControl size="small" error={Boolean(error)} disabled={disabled}>
          <InputLabel id={`${id}-day`}>Jour</InputLabel>
          <Select labelId={`${id}-day`} label="Jour" value={parts.day} onChange={pick('day')}>
            {DAYS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" error={Boolean(error)} disabled={disabled}>
          <InputLabel id={`${id}-month`}>Mois</InputLabel>
          <Select labelId={`${id}-month`} label="Mois" value={parts.month} onChange={pick('month')}>
            {MONTH_OPTIONS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
      {error && <FormHelperText error>{error}</FormHelperText>}
    </Box>
  );
}
