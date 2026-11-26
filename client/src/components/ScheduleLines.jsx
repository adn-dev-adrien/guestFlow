/**
 * ScheduleLines — the dated amounts of a staged payment, one line each: label · amount · state badge, with an
 * optional line of detail under it (a bank reference, a note). The same drawing serves the tranches of a card
 * payment (specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 18), and any later payment made of parts.
 *
 * It computes nothing: every label, amount text and state wording is the caller's, already shaped by the server.
 * Colour carries the STATE only (the badge); the label is always words.
 *
 * Props:
 *   lines:  [{ key, label, amount (ReactNode|string, already formatted), stateLabel, tone, detail? }]
 *           tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' (the StatusBadge statuses);
 *           detail?: ReactNode drawn under the line
 *   indent?: boolean — set the block in under the row it belongs to (default true)
 *   label?:  string — accessible name of the list
 *
 * Responsive: under 480 px of width (container query) a line is two rows — label + amount, then the state;
 * wider, one row `label | amount | state`. Amounts never wrap.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';

export default function ScheduleLines({ lines = [], indent = true, label }) {
  if (lines.length === 0) return null;
  return (
    <Box
      component="ul"
      aria-label={label}
      data-testid="schedule-lines"
      sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0, pl: indent ? { xs: 1.5, sm: 3 } : 0, containerType: 'inline-size' }}
    >
      {lines.map((line) => (
        <Box component="li" key={line.key} data-line={line.key} sx={{ py: 0.75 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gridTemplateAreas: '"label amount" "state state"',
              columnGap: 1.25,
              rowGap: 0.5,
              alignItems: 'center',
              '@container (min-width: 480px)': {
                gridTemplateColumns: 'minmax(0, 1fr) 110px minmax(0, 250px)',
                gridTemplateAreas: '"label amount state"',
              },
            }}
          >
            <Typography component="span" variant="body2" sx={{ gridArea: 'label', minWidth: 0, overflowWrap: 'anywhere', color: 'text.secondary' }}>
              {line.label}
            </Typography>
            <Typography component="span" variant="body2" sx={{ gridArea: 'amount', justifySelf: 'end', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {line.amount}
            </Typography>
            <Box sx={{ gridArea: 'state', minWidth: 0, justifySelf: { xs: 'start', sm: 'stretch' } }}>
              {line.stateLabel && <StatusBadge status={line.tone || 'neutral'} label={line.stateLabel} wrap />}
            </Box>
          </Box>
          {line.detail && <Box sx={{ mt: 0.25 }}>{line.detail}</Box>}
        </Box>
      ))}
    </Box>
  );
}
