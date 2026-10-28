/**
 * LaundryScheduleSection — the « Blanchisserie » card of the Linge page
 * (specs/linen-laundry-days.md §3.4 rules 19-22): the days the linen goes to the laundry and how many
 * days the laundry keeps it, with the cycle the server describes.
 *
 * Refusals show before Save: unticking the last day keeps it ticked and shakes the row, the stepper
 * stops at 1 and 14, a typed value outside 1..14 is flagged. They mirror the server's rules for comfort;
 * `error` (the server's `{ field, message }`) replaces them. The cycle comes from
 * `POST /api/laundry/schedule/preview`, debounced; the previous lines stay, dimmed, while it loads, and
 * a failed preview leaves the last good cycle. Nothing here computes the cycle.
 *
 * Props:
 *   value        { weekdays: number[], turnaroundText: string } — the draft (0 = Sunday … 6 = Saturday)
 *   onChange     (next: value) => void
 *   initialCycle { cycle: [{ dropWeekday, pickUpWeekday, waitDays }], longestWaitDays } | null —
 *                shown until the first preview answers
 *   caption      string | null — the « À partir de demain … » line, built by the page
 *   error        { field: 'weekdays' | 'turnaroundDays', message: string } | null — the server's refusal
 *   disabled     boolean
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Card, CardContent, IconButton, InputBase, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { api } from '../sdk';
import { WEEKDAYS, weekdayAbbr } from './weekdays';
import {
  MAX_TURNAROUND, MIN_TURNAROUND, TURNAROUND_ERROR, WEEKDAYS_ERROR,
  isDraftValid, parseTurnaround, scheduleBody,
} from './laundryScheduleDraft';

const PREVIEW_DEBOUNCE_MS = 250;

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const reducedMotion = '@media (prefers-reduced-motion: reduce)';

// The row shakes when the last day is refused; no remount (the focus stays), no motion when reduced.
function nudge(element) {
  if (!element || typeof element.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)', offset: 0.3 }, { transform: 'translateX(3px)', offset: 0.6 }, { transform: 'translateX(0)' }],
    { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}

function FieldRow({ id, label, children }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '150px 1fr' }, columnGap: 2, rowGap: 1, alignItems: 'start', mb: 1.5 }}>
      <Typography id={id} variant="body2" color="text.secondary" component="label" sx={{ pt: { sm: 1.4 } }}>{label}</Typography>
      <Box>{children}</Box>
    </Box>
  );
}

function ErrorLine({ id, message }) {
  return (
    <Typography id={id} role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 0.75, minHeight: message ? undefined : 0 }}>
      {message}
    </Typography>
  );
}

export default function LaundryScheduleSection({
  value, onChange, initialCycle = null, caption = null, error = null, disabled = false,
}) {
  const [refusal, setRefusal] = useState('');
  const daysRef = useRef(null);
  const [cycle, setCycle] = useState(initialCycle);
  const [loading, setLoading] = useState(false);
  const lastGood = useRef(initialCycle);

  const turnaround = parseTurnaround(value.turnaroundText);
  const turnaroundValid = turnaround !== null;
  const draftValid = isDraftValid(value);
  const previewKey = draftValid ? JSON.stringify(scheduleBody(value)) : null;

  useEffect(() => {
    if (!previewKey) return undefined;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewLaundrySchedule(JSON.parse(previewKey));
        if (cancelled) return;
        lastGood.current = result;
        setCycle(result);
      } catch {
        if (!cancelled) setCycle(lastGood.current);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [previewKey]);

  const toggleDays = (event, next) => {
    if (!next || next.length === 0) {
      setRefusal(WEEKDAYS_ERROR);
      nudge(daysRef.current);
      return;
    }
    setRefusal('');
    onChange({ ...value, weekdays: [...next].sort((a, b) => a - b) });
  };

  const setTurnaround = (text) => onChange({ ...value, turnaroundText: String(text) });
  const step = (delta) => {
    const base = turnaroundValid ? turnaround : MIN_TURNAROUND;
    setTurnaround(Math.min(MAX_TURNAROUND, Math.max(MIN_TURNAROUND, base + delta)));
  };

  const daysMessage = error?.field === 'weekdays' ? error.message : refusal;
  const turnaroundMessage = error?.field === 'turnaroundDays'
    ? error.message
    : (turnaroundValid ? '' : TURNAROUND_ERROR);
  const turnaroundBad = Boolean(turnaroundMessage);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 1.25, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <LocalLaundryServiceIcon color="action" />
          <Typography variant="sectionHeader">Blanchisserie</Typography>
        </Box>

        <FieldRow id="laundry-days-label" label="Jours">
          <ToggleButtonGroup
            ref={daysRef}
            value={value.weekdays}
            onChange={toggleDays}
            disabled={disabled}
            aria-labelledby="laundry-days-label"
            aria-describedby="laundry-days-error"
            sx={{
              display: 'flex', gap: { xs: '1px', sm: 0.75 }, width: { xs: '100%', sm: 'auto' },
              '& .MuiToggleButtonGroup-grouped': {
                flex: { xs: 1, sm: 'none' }, minWidth: { xs: 0, sm: 44 }, height: 44, borderRadius: '10px !important',
                border: '1px solid', borderColor: 'divider', fontWeight: 600, touchAction: 'manipulation',
                transition: 'background-color 150ms ease, color 150ms ease, transform 100ms ease',
                '&:active': { transform: 'scale(0.95)' },
                [reducedMotion]: { transition: 'none', '&:active': { transform: 'none' } },
                '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', borderColor: 'primary.main' },
                '&.Mui-selected:hover': { bgcolor: 'primary.dark' },
              },
            }}
          >
            {WEEKDAYS.map((w) => (
              <ToggleButton key={w.value} value={w.value} aria-label={capitalize(w.label)} title={capitalize(w.label)}>
                {w.letter}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ErrorLine id="laundry-days-error" message={daysMessage} />
        </FieldRow>

        <FieldRow id="laundry-turnaround-label" label="Linge prêt après">
          <Box
            role="group"
            aria-labelledby="laundry-turnaround-label"
            sx={{
              display: 'flex', alignItems: 'center', width: { xs: '100%', sm: 'fit-content' },
              border: '1px solid', borderColor: turnaroundBad ? 'error.main' : 'divider', borderRadius: '10px', overflow: 'hidden',
              bgcolor: (theme) => (turnaroundBad ? alpha(theme.palette.error.main, 0.06) : 'background.paper'),
              userSelect: 'none', WebkitUserSelect: 'none',
            }}
          >
            <IconButton
              aria-label="Un jour de moins"
              onClick={() => step(-1)}
              disabled={disabled || (turnaroundValid && turnaround <= MIN_TURNAROUND)}
              sx={{ borderRadius: 0, width: 44, height: 44, bgcolor: 'action.hover', touchAction: 'manipulation' }}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            <InputBase
              value={value.turnaroundText}
              onChange={(e) => setTurnaround(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
              }}
              disabled={disabled}
              inputProps={{
                inputMode: 'numeric', 'aria-label': 'Délai en jours', 'aria-invalid': turnaroundBad, 'aria-describedby': 'laundry-turnaround-error',
                style: { textAlign: 'right', width: 46, padding: '0 4px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 16 },
              }}
              sx={{ height: 44 }}
            />
            <Typography sx={{ pl: 0.5, pr: 1.5, flex: { xs: 1, sm: 'none' }, minWidth: 52, color: 'text.secondary' }}>
              {turnaround !== null && turnaround > 1 ? 'jours' : 'jour'}
            </Typography>
            <IconButton
              aria-label="Un jour de plus"
              onClick={() => step(1)}
              disabled={disabled || (turnaroundValid && turnaround >= MAX_TURNAROUND)}
              sx={{ borderRadius: 0, width: 44, height: 44, bgcolor: 'action.hover', touchAction: 'manipulation' }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
          <ErrorLine id="laundry-turnaround-error" message={turnaroundMessage} />
        </FieldRow>

        {cycle && cycle.cycle.length > 0 && (
          <Stack
            aria-live="polite"
            data-testid="laundry-cycle"
            spacing={0.5}
            sx={{
              borderTop: '1px solid', borderColor: 'divider', mt: 1.5, pt: 1.5,
              opacity: loading ? 0.45 : 1, transition: 'opacity 200ms ease', [reducedMotion]: { transition: 'none' },
            }}
          >
            {cycle.cycle.map((line) => (
              <Box key={line.dropWeekday} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline' }}>
                <Typography component="b" sx={{ fontWeight: 600, minWidth: 110 }}>
                  {capitalize(weekdayAbbr(line.dropWeekday))} → {weekdayAbbr(line.pickUpWeekday)}
                </Typography>
                <Typography
                  component="span"
                  sx={{ color: line.waitDays > 7 ? 'warning.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {line.waitDays} j
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        {caption && (
          <Typography
            variant="body2"
            sx={{
              mt: 1.5, display: 'inline-block', px: 1.25, py: 0.75, borderRadius: 2, color: 'info.dark',
              bgcolor: (theme) => alpha(theme.palette.info.main, 0.1),
            }}
          >
            {caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
