/**
 * SettingsFiscalYearSection — « Exercice comptable » card.
 *
 * One setting: the month the books are closed on. The exercise ends on the last day of that month
 * and starts on the first day of the next one — September ⇒ 1 October → 30 September. December (the
 * default) means the exercise is the calendar year. Every annual figure of the Suivi financier is
 * derived from it SERVER-side; the hint below the Select is pure presentational echo of the picked
 * value, not a business rule (specs/fiscal-year-and-nights-sold.md §3.1 + §6.1).
 *
 * Below it, the annual revenue goal of the current and the next exercise
 * (specs/finance-dashboard-redesign.md §3.8). Their labels and today's revenue come from the server
 * (`goalContext`); a field left empty means « no goal ». The red message is immediate feedback — the
 * server re-validates on save.
 *
 * Props:
 *   values:       { fiscalYearEndMonth, revenueGoals: { [exerciseKey]: number | string } }
 *   errors:       { fiscalYearEndMonth?, 'revenueGoals.<key>'? }
 *   onChange:     (key, value) => void   // 'fiscalYearEndMonth' | 'revenueGoals' (the whole object)
 *   goalContext:  { current: { key, label, revenue }, next: { key, label } } | null
 *   disabled:     boolean
 */
import React from 'react';
import { Card, CardContent, Stack, Typography, TextField, MenuItem, Box } from '@mui/material';
import { MONTH_OPTIONS, labelForMonth } from '../constants/months';
import { revenueGoalInputError } from '../utils/validation';
import { formatCurrencyRounded } from '../utils/formatters';

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

// A stored goal arrives as a number and is shown with its thousands separator; what the operator
// types is kept as typed until it is saved.
const goalText = (value) => (typeof value === 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : (value ?? ''));

function GoalField({ exercise, isCurrent, value, serverError, onChange, disabled }) {
  const clientError = revenueGoalInputError(value);
  const error = clientError || serverError;
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  // Presentational echo of the typed goal against today's revenue (rule 28) — like the exercise
  // bounds hint above, it restates what is on screen and decides nothing.
  const hint = isCurrent && !error && amount > 0
    ? `Aujourd'hui : ${formatCurrencyRounded(exercise.revenue)}, soit ${Math.round((exercise.revenue / amount) * 100)} % de l'objectif.`
    : 'Laissez vide pour ne pas afficher de barre.';
  return (
    <TextField
      label={`Exercice ${exercise.label}${isCurrent ? ' (en cours)' : ''}`}
      value={goalText(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Aucun objectif"
      error={Boolean(error)}
      helperText={error || hint}
      disabled={disabled}
      fullWidth
      slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>€</Box> } }}
    />
  );
}

export function hasInvalidRevenueGoal(goals) {
  return Object.values(goals || {}).some((value) => Boolean(revenueGoalInputError(value)));
}

export default function SettingsFiscalYearSection({
  values,
  errors = {},
  onChange,
  goalContext = null,
  disabled = false,
}) {
  const v = values || {};
  const endMonth = v.fiscalYearEndMonth ?? 12;
  const goals = v.revenueGoals || {};
  const setGoal = (key, text) => onChange('revenueGoals', { ...goals, [key]: text });
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

          {goalContext && (
            <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2">Objectif de chiffre d'affaires</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Net de commissions, comme le chiffre affiché en tête du Suivi financier.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {[{ exercise: goalContext.current, isCurrent: true }, { exercise: goalContext.next, isCurrent: false }].map(({ exercise, isCurrent }) => (
                  <GoalField
                    key={exercise.key}
                    exercise={exercise}
                    isCurrent={isCurrent}
                    value={goals[exercise.key]}
                    serverError={errors[`revenueGoals.${exercise.key}`]}
                    onChange={(text) => setGoal(exercise.key, text)}
                    disabled={disabled}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
