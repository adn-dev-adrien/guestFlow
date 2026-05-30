import React, { useMemo } from 'react';
import { Card, CardContent, Stack, TextField, MenuItem, Typography } from '@mui/material';

/**
 * MonthYearPicker — shared month + year selector card.
 *
 * Used on the Comptabilité page and the Suivi taxe de séjour page so the period selection looks
 * (and reads) the same everywhere a monthly export/extraction is offered.
 *
 * Props:
 *   month        number (1–12)
 *   year         number (e.g. 2026)
 *   onChange     (next: { month, year }) => void
 *   description  optional ReactNode shown next to the fields (a short caption explaining what the
 *                period feeds: CSV ventes, extraction taxe, etc.)
 *   yearsRange   number of selectable years (default 5, current + previous 3 + next 1)
 *   maxMonth     'YYYY-MM' string — when set, options whose (year, month) > max are hidden
 *                (used by Tourist Tax which only allows fully-past months)
 *   helperText   optional helper text shown under the Mois field
 */

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function pad2(v) { return String(v).padStart(2, '0'); }

export default function MonthYearPicker({
  month,
  year,
  onChange,
  description,
  yearsRange = 5,
  maxMonth,
  helperText,
}) {
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    // current + 1 down to current - (range - 2). E.g. range=5 → [+1, 0, -1, -2, -3].
    return Array.from({ length: yearsRange }, (_, i) => current + 1 - i);
  }, [yearsRange]);

  const [maxYear, maxMonthNumber] = useMemo(() => {
    if (!maxMonth) return [null, null];
    const m = String(maxMonth).match(/^(\d{4})-(\d{2})$/);
    if (!m) return [null, null];
    return [Number(m[1]), Number(m[2])];
  }, [maxMonth]);

  const isMonthAvailable = (m) => {
    if (!maxYear || !maxMonthNumber) return true;
    if (year > maxYear) return false;
    if (year === maxYear && m > maxMonthNumber) return false;
    return true;
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          // `flex-start` keeps the inputs themselves vertically aligned on sm+; any helperText hangs
          // naturally below "Mois" without offsetting "Année".
          alignItems={{ xs: 'stretch', sm: 'flex-start' }}
        >
          {/* Both selectors share the same fixed width on sm+ so they stay visually aligned.
              On xs they stretch to full width naturally (Stack's `alignItems: 'stretch'`). */}
          <TextField
            select
            label="Mois"
            value={month}
            onChange={(e) => onChange({ month: Number(e.target.value), year })}
            fullWidth
            sx={{ maxWidth: { xs: '100%', sm: 180 } }}
            helperText={helperText}
          >
            {MONTHS.map((label, i) => (
              <MenuItem key={i} value={i + 1} disabled={!isMonthAvailable(i + 1)}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Année"
            value={year}
            onChange={(e) => onChange({ month, year: Number(e.target.value) })}
            fullWidth
            sx={{ maxWidth: { xs: '100%', sm: 180 } }}
          >
            {years.map((y) => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </TextField>
          {description && (
            <Typography variant="body2" color="text.secondary">{description}</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// Exported helpers so callers can convert between the `{ month, year }` shape and the `YYYY-MM`
// string format used by some endpoints (tourist-tax).
MonthYearPicker.toYearMonth = ({ month, year }) => `${year}-${pad2(month)}`;
MonthYearPicker.fromYearMonth = (ym) => {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    const d = new Date();
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }
  return { month: Number(m[2]), year: Number(m[1]) };
};
