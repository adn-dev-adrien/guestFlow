/**
 * SettingsFiscalYearSection — « Exercice comptable » card.
 *
 * One setting: the month the books are closed on. The exercise ends on the last day of that month
 * and starts on the first day of the next one — September ⇒ 1 October → 30 September. December (the
 * default) means the exercise is the calendar year. Every annual figure of the Suivi financier is
 * derived from it SERVER-side; the hint below the Select is pure presentational echo of the picked
 * value, not a business rule (specs/fiscal-year-and-nights-sold.md §3.1 + §6.1).
 *
 * Props:
 *   values:    { fiscalYearEndMonth }
 *   errors:    { fiscalYearEndMonth? }
 *   onChange:  (key, value) => void   // key is 'fiscalYearEndMonth'
 *   disabled:  boolean
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField, MenuItem, Box } from '@mui/material';
import { MONTH_OPTIONS, labelForMonth } from '../constants/months';

// « L'exercice ira du 1er octobre au 30 septembre. » — the start month is the one after the closing
// month, and « 1er » is the only French ordinal that differs from the plain number.
function boundsHint(endMonth) {
  const closing = Number(endMonth);
  if (!Number.isInteger(closing) || closing < 1 || closing > 12) return '';
  if (closing === 12) return "L'exercice suit l'année civile : du 1er janvier au 31 décembre.";
  const startMonth = (closing % 12) + 1;
  // Last day of the closing month, taken on a leap year so February reads 29 rather than 28.
  const lastDay = new Date(Date.UTC(2024, closing, 0)).getUTCDate();
  return `L'exercice ira du 1er ${labelForMonth(startMonth).toLowerCase()} au ${lastDay} ${labelForMonth(closing).toLowerCase()}.`;
}

export default function SettingsFiscalYearSection({
  values,
  errors = {},
  onChange,
  disabled = false,
}) {
  const v = values || {};
  const endMonth = v.fiscalYearEndMonth ?? 12;
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">
              Exercice comptable
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sur quel mois votre bilan est-il arrêté ? Le suivi financier calcule ses totaux annuels
              sur cet exercice.
            </Typography>
          </Box>

          <TextField
            select
            label="Mois de clôture"
            value={endMonth}
            onChange={(e) => onChange('fiscalYearEndMonth', Number(e.target.value))}
            fullWidth
            disabled={disabled}
            error={Boolean(errors.fiscalYearEndMonth)}
            helperText={errors.fiscalYearEndMonth || boundsHint(endMonth)}
            sx={{ maxWidth: { sm: 320 } }}
          >
            {MONTH_OPTIONS.map((m) => (
              <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </CardContent>
    </Card>
  );
}
