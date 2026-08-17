import React from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';

/**
 * SlotPickerGrid — pick a time slot inside one day.
 *
 * Renders a server-classified slot list as large tappable chips. It derives **nothing**: whether a
 * slot is bookable, why it is not, whether the resource is still warm and what an evening slot costs
 * extra are all decided server-side and arrive on each slot. That is deliberate — a client that
 * re-derived availability would eventually disagree with the writer and double-book.
 *
 * Props:
 *  - `slots`     : [{ start, end, state, warm?, supplement? }] — `state ∈ free | taken | heating | past | closed`
 *  - `onPick`    : (slot) => void — called only for a `free` slot
 *  - `selected`  : array of `start` strings to render as chosen
 *  - `emptyLabel`: shown when `slots` is empty
 *
 * Sizing targets a thumb: ≥ 48 px tall, 2 columns on `xs`, 4 from `sm` up.
 */

const STATE_REASON = {
  taken: 'Déjà réservé',
  heating: 'Montée en chauffe',
  past: 'Déjà passé',
  closed: 'Fermé',
};

export default function SlotPickerGrid({ slots = [], onPick, selected = [], emptyLabel = 'Aucun créneau ce jour.' }) {
  if (!slots.length) {
    return <Typography variant="caption" color="text.secondary">{emptyLabel}</Typography>;
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
        gap: 1,
      }}
    >
      {slots.map((slot) => {
        const isFree = slot.state === 'free';
        const isSelected = selected.includes(slot.start);
        const supplement = Number(slot.supplement || 0);
        const reason = STATE_REASON[slot.state] || '';
        const label = (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2, py: 0.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <span>{slot.start}</span>
              {isFree && slot.warm && <LocalFireDepartmentIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
            </Box>
            {isFree && supplement > 0 && (
              <Typography component="span" variant="caption" sx={{ fontSize: 10, color: 'warning.dark' }}>
                +{supplement} €
              </Typography>
            )}
            {!isFree && (
              <Typography component="span" variant="caption" sx={{ fontSize: 9, opacity: 0.8 }}>
                {reason}
              </Typography>
            )}
          </Box>
        );

        const chip = (
          <Chip
            label={label}
            onClick={isFree ? () => onPick?.(slot) : undefined}
            disabled={!isFree}
            variant={isSelected ? 'filled' : 'outlined'}
            color={isSelected ? 'primary' : (isFree && supplement > 0 ? 'warning' : 'default')}
            aria-label={`${slot.start} — ${isFree ? (supplement > 0 ? `libre, supplément ${supplement} €` : 'libre') : reason}`}
            sx={{
              width: '100%',
              minHeight: 48,
              height: 'auto',
              borderRadius: 1.5,
              '& .MuiChip-label': { px: 1, width: '100%' },
            }}
          />
        );

        // A disabled MUI Chip swallows pointer events, so the tooltip has to wrap a plain element.
        return isFree ? (
          <Box key={slot.start}>{chip}</Box>
        ) : (
          <Tooltip key={slot.start} title={`${slot.start}–${slot.end} · ${reason}`} arrow>
            <Box>{chip}</Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
