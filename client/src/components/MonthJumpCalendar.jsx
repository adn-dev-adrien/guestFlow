/**
 * MonthJumpCalendar — a day picker that stays quick over a long booking horizon.
 *
 * A horizontal, scrollable row of month chips (from the current month to the month of the horizon) jumps
 * straight to a month; the month grid below disables the days before today and after the horizon.
 * The limit comes from the server (`horizonUntil`, specs/gift-vouchers/gift-voucher-campaigns.md rule 51): this component
 * never works out how far ahead a booking may go, it only greys out what it is told is out of reach.
 *
 * Props:
 *   value:           string          — the selected day, `YYYY-MM-DD`, or '' / undefined for none
 *   onChange:        (iso) => void   — a day was picked
 *   horizonUntil:    string          — last bookable day, `YYYY-MM-DD`; without it the grid is not bounded
 *                                      forward and the chips row is not drawn
 *   isDayDisabled?:  (iso) => boolean — extra days to grey out (closed, full…)
 *   onNextAvailable?: () => void     — when given, a « Prochaine disponibilité » button calls it; the parent
 *                                      resolves the day (server) and answers through `value`
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
const parseMonth = (key) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 });
const shift = ({ year, month }, by) => { const d = new Date(year, month + by, 1); return { year: d.getFullYear(), month: d.getMonth() }; };

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const FULL_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function todayIso() {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
}

function monthsBetween(from, to) {
  const out = [];
  for (let cursor = from; monthKey(cursor.year, cursor.month) <= monthKey(to.year, to.month); cursor = shift(cursor, 1)) out.push(cursor);
  return out;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MonthJumpCalendar({
  value, onChange, horizonUntil, isDayDisabled, onNextAvailable,
}) {
  const today = todayIso();
  const start = parseMonth(today.slice(0, 7));
  const last = horizonUntil ? parseMonth(horizonUntil.slice(0, 7)) : null;
  const [shown, setShown] = useState(() => parseMonth((value || today).slice(0, 7)));
  const chipRefs = useRef({});

  useEffect(() => {
    if (value) setShown(parseMonth(value.slice(0, 7)));
  }, [value]);

  const chips = last ? monthsBetween(start, last) : [];
  const shownKey = monthKey(shown.year, shown.month);

  useEffect(() => {
    const el = chipRefs.current[shownKey];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }, [shownKey]);

  const canGoBack = shownKey > monthKey(start.year, start.month);
  const canGoForward = !last || shownKey < monthKey(last.year, last.month);

  const first = new Date(shown.year, shown.month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(shown.year, shown.month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const disabled = (iso) => iso < today || (horizonUntil && iso > horizonUntil) || (isDayDisabled && isDayDisabled(iso));

  return (
    <Box sx={{ width: '100%', maxWidth: 360 }}>
      {chips.length > 0 && (
        <Box
          role="group"
          aria-label="Aller à un mois"
          sx={{
            display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 1, scrollSnapType: 'x proximity', scrollbarWidth: 'thin',
          }}
        >
          {chips.map((m, i) => {
            const key = monthKey(m.year, m.month);
            const withYear = i === 0 || m.month === 0;
            const label = `${SHORT.format(new Date(m.year, m.month, 1))}${withYear ? ` ${m.year}` : ''}`;
            return (
              <Chip
                key={key}
                ref={(el) => { chipRefs.current[key] = el; }}
                label={label}
                aria-label={LONG.format(new Date(m.year, m.month, 1))}
                aria-pressed={key === shownKey}
                color={key === shownKey ? 'primary' : 'default'}
                variant={key === shownKey ? 'filled' : 'outlined'}
                onClick={() => setShown(m)}
                sx={{ flexShrink: 0, minHeight: 44, scrollSnapAlign: 'center' }}
              />
            );
          })}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton aria-label="Mois précédent" disabled={!canGoBack} onClick={() => setShown(shift(shown, -1))} sx={{ minWidth: 44, minHeight: 44 }}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle1" component="h3" sx={{ textTransform: 'capitalize' }} aria-live="polite">
          {LONG.format(first)}
        </Typography>
        <IconButton aria-label="Mois suivant" disabled={!canGoForward} onClick={() => setShown(shift(shown, 1))} sx={{ minWidth: 44, minHeight: 44 }}>
          <ChevronRightIcon />
        </IconButton>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {WEEKDAYS.map((d, i) => (
          <Typography key={`${d}-${i}`} variant="caption" color="text.secondary" align="center" aria-hidden="true">{d}</Typography>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <Box key={`blank-${i}`} />;
          const iso = isoOf(shown.year, shown.month, day);
          const picked = iso === value;
          return (
            <Button
              key={iso}
              size="small"
              disabled={Boolean(disabled(iso))}
              aria-label={FULL_DAY.format(new Date(shown.year, shown.month, day))}
              aria-pressed={picked}
              variant={picked ? 'contained' : 'text'}
              onClick={() => onChange(iso)}
              sx={{ minWidth: 0, minHeight: 44, p: 0 }}
            >
              {day}
            </Button>
          );
        })}
      </Box>

      {onNextAvailable && (
        <Button variant="outlined" onClick={onNextAvailable} sx={{ mt: 2, minHeight: 44 }} fullWidth>
          Prochaine disponibilité
        </Button>
      )}
    </Box>
  );
}
