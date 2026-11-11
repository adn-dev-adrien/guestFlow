/**
 * NextArrivalBlock — the home's « Prochaine arrivée »: the day of the next arrival, set large with its
 * distance in a chip, and one compact row per stay arriving that day (specs/dashboard-planning-scroll.md
 * rule 5). Rows carry no check box: the operational ticks belong to the day itself and to the Planning.
 *
 * Props:
 *   nextArrival  { date, label, relativeLabel, reservations }  as GET /api/planning/today sends it
 *   onOpen?      (reservation) => void  a row opens the fiche; omitted, the rows are inert (reception)
 *   bedsLabel    (reservation) => string | null  the beds to prepare, null when the stay has none
 */
import React from 'react';
import { Box, ButtonBase, Chip, Typography } from '@mui/material';
import { NEXT_ARRIVAL_TITLE } from '../constants/planningCopy';

const ROW_GRID = {
  display: 'grid',
  gridTemplateColumns: { xs: '52px minmax(0, 1fr)', sm: '64px minmax(0, 1.2fr) minmax(0, 1.4fr) auto' },
  columnGap: 1.5,
  rowGap: 0.25,
  alignItems: 'start',
};

export default function NextArrivalBlock({ nextArrival, onOpen, bedsLabel }) {
  return (
    <Box
      data-testid="next-arrival"
      sx={{ mt: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.25, px: 2, pt: 1.75, pb: 1.25 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ flexBasis: '100%', lineHeight: 1.6 }}
        >
          {NEXT_ARRIVAL_TITLE}
        </Typography>
        <Typography
          component="h3"
          sx={{ fontWeight: 700, fontSize: '1.3rem', lineHeight: 1.2, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}
        >
          {nextArrival.label}
        </Typography>
        <Chip label={nextArrival.relativeLabel} size="small" color="primary" variant="outlined" sx={{ fontWeight: 600 }} />
      </Box>
      {nextArrival.reservations.map((r) => {
        const beds = bedsLabel(r);
        const content = (
          <>
            <Typography component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {r.checkInTime || '15:00'}
            </Typography>
            <Typography component="span" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{r.propertyName}</Typography>
            <Typography component="span" sx={{ overflowWrap: 'anywhere', minWidth: 0, gridColumn: { xs: 2, sm: 'auto' } }}>
              {r.firstName} {r.lastName}
            </Typography>
            {beds && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', gridColumn: { xs: 2, sm: 'auto' } }}>
                {`Lits ${beds}`}
              </Typography>
            )}
          </>
        );
        const rowSx = {
          ...ROW_GRID, width: '100%', textAlign: 'left', px: 2, py: 1.5, minHeight: 48, borderTop: '1px solid', borderColor: 'divider',
        };
        return onOpen ? (
          <ButtonBase
            key={r.id}
            component="div"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r)}
            sx={{ ...rowSx, display: 'grid', '&:hover': { bgcolor: 'action.hover' } }}
            data-testid="next-arrival-row"
          >
            {content}
          </ButtonBase>
        ) : (
          <Box key={r.id} sx={rowSx} data-testid="next-arrival-row">{content}</Box>
        );
      })}
    </Box>
  );
}
