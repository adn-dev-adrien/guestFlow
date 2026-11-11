import React, { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DAY_NAMES, shiftDate } from '../utils/calendarVisuals';
import { buildMonthLayout, monthWeekStarts, normalizeItems, frRange, closedRange } from '../utils/calendarLayout';
import { barTint, closureHatch } from '../utils/calendarVisuals';
import { CELL_TOP_BAND_H } from './CalendarDayCell';
import { formatPlatformLabel } from '../constants/platforms';

const GAP = 4;
const RIBBON_H = 34;
const RIBBON_INSET = 6;

// A closure only needs a ribbon when a stay holds some of its days: the cells then cannot show both.
const overlapsStay = (closureBar, bars) => bars.some((b) => b.item.kind === 'reservation'
  && b.leftEdge < closureBar.rightEdge && closureBar.leftEdge < b.rightEdge);

// x position of a fractional column edge (0..7) inside a row of seven cells separated by GAP px: a half
// edge is the middle of a cell, a whole edge the start of a cell (left) or the end of the previous one (right).
const edgeOffset = (edge, isRight) => (edge % 1 !== 0 ? -GAP / 2 : (isRight ? -GAP : 0));

/**
 * CalendarMonthGrid — one month block of the logement calendar: a weekday header, the month's whole
 * weeks of day cells (the greyed days of the previous / next month at either end are real, interactive
 * days — a selection can cross a month end), and one name ribbon per week segment of every stay
 * (specs/calendar-property-parity.md rules 16, 18-20). The ribbon is filled with the stay's own colour, so
 * the diagonal halves under it never lower the contrast, and is truncated only by its width: the full
 * name, platform and dates are in its tooltip and its accessible name.
 * Pure layout; each day is rendered via `renderCell(day, year, month, outside)` (the page supplies a keyed
 * <CalendarDayCell>), the month title and scrolling come from InfiniteMonthScroller.
 *
 * Props:
 *  - year, month (0-based)
 *  - stays: the payload's stays for this block's range (label, platformDisplay, color, textColor, past)
 *  - closures: the payload's closures; one that sits on days a stay also holds (a conflict the cells cannot show
 *    both of) gets a hatched ribbon of its own in a lane, as on « Tous »
 *  - renderCell: (day, y, m, outside) => ReactNode (must carry its own key)
 *  - onReservationClick: (id) => void
 */
export default function CalendarMonthGrid({ year, month, stays, closures = [], renderCell, onReservationClick }) {
  const theme = useTheme();
  const items = useMemo(() => normalizeItems(stays, closures.filter((c) => !c.global)), [stays, closures]);
  const weekStarts = useMemo(() => monthWeekStarts(year, month), [year, month]);
  // The lane packing of « Tous » decides which ribbon sits where: two stays that overlap (a conflict the
  // operator has to see) stack in lanes instead of hiding each other.
  const { weeks } = useMemo(() => buildMonthLayout(year, month, items, ''), [year, month, items]);

  return (
    <Box sx={{ userSelect: 'none' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${GAP}px`, my: 0.75 }}>
        {DAY_NAMES.map((d) => (
          <Box key={d} sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary', fontSize: 12 }}>{d}</Box>
        ))}
      </Box>
      {weekStarts.map((weekStart, weekIndex) => (
        <Box
          key={weekStart}
          sx={{
            position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${GAP}px`,
            mb: `${GAP + Math.max(0, weeks[weekIndex].laneCount - 1) * (RIBBON_H + GAP)}px`,
          }}
        >
          {Array.from({ length: 7 }, (_, i) => {
            const date = shiftDate(weekStart, i);
            const [y, mo, d] = date.split('-').map(Number);
            return renderCell(d, y, mo - 1, mo - 1 !== month);
          })}
          {weeks[weekIndex].bars.filter((bar, _i, all) => bar.item.kind === 'reservation' || overlapsStay(bar, all)).map(({ item, leftEdge, rightEdge, lane }) => {
            if (item.kind === 'closure') {
              const label = `${item.propertyName || 'Logement'} fermé — ${item.label}, ${closedRange(item)}`;
              return (
                <Tooltip key={`${item.key}-${leftEdge}`} title={label} arrow enterDelay={300}>
                  <Box
                    role="img"
                    tabIndex={0}
                    aria-label={label}
                    data-closure-ribbon={item.key}
                    sx={{
                      position: 'absolute', top: CELL_TOP_BAND_H + lane * (RIBBON_H + GAP), height: RIBBON_H, zIndex: 4,
                      left: `calc(${leftEdge} * (100% + ${GAP}px) / 7 + ${edgeOffset(leftEdge, false) + RIBBON_INSET}px)`,
                      width: `calc(${rightEdge - leftEdge} * (100% + ${GAP}px) / 7 + ${edgeOffset(rightEdge, true) - edgeOffset(leftEdge, false) - 2 * RIBBON_INSET}px)`,
                      display: 'flex', alignItems: 'center', px: 1, borderRadius: '7px', overflow: 'hidden',
                      bgcolor: 'background.paper', backgroundImage: closureHatch(theme), color: 'text.primary',
                      border: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.25), fontSize: 12, fontWeight: 600,
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
                    }}
                  >
                    Fermé · {item.label}
                  </Box>
                </Tooltip>
              );
            }
            const platform = item.platformDisplay || formatPlatformLabel(item.platform);
            const dates = frRange(item.startDate, item.endDate);
            const full = `${item.guestLabel} — ${platform}, ${dates}`;
            const offsetL = edgeOffset(leftEdge, false);
            const offsetR = edgeOffset(rightEdge, true);
            return (
              <Tooltip key={`${item.key}-${leftEdge}`} title={full} arrow enterDelay={300}>
                <Box
                  role="button"
                  tabIndex={0}
                  aria-label={full}
                  data-ribbon={item.key}
                  onClick={() => onReservationClick(item.reservationId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReservationClick(item.reservationId); }
                  }}
                  sx={{
                    position: 'absolute', top: CELL_TOP_BAND_H + lane * (RIBBON_H + GAP), height: RIBBON_H, zIndex: 4,
                    left: `calc(${leftEdge} * (100% + ${GAP}px) / 7 + ${offsetL + RIBBON_INSET}px)`,
                    width: `calc(${rightEdge - leftEdge} * (100% + ${GAP}px) / 7 + ${offsetR - offsetL - 2 * RIBBON_INSET}px)`,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', px: 1, borderRadius: '7px',
                    cursor: 'pointer', overflow: 'hidden',
                    // A stay that is over keeps the soft look of « Tous » and the phone: tint, stripe, ink.
                    ...(item.past
                      ? { bgcolor: barTint(item.color), color: 'text.primary', boxShadow: `inset 3px 0 0 ${item.color}` }
                      : { bgcolor: item.color, color: item.textColor, boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }),
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
                  }}
                >
                  <Box component="span" sx={{ flexShrink: 0, fontSize: 12.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.guestLabel}
                  </Box>
                  <Box component="span" sx={{ flexShrink: 0, fontSize: 10.5, fontWeight: 500, lineHeight: 1.2, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {platform}
                  </Box>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
