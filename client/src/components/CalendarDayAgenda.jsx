import React, { useMemo } from 'react';
import { Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { DAY_NAMES, formatDate, shiftDate, getDaysInMonth, barTint, closureHatch } from '../utils/calendarVisuals';
import { buildDaySummary, isEmptyDay } from '../utils/calendarDaySummary';
import { getClosureDayParts } from '../utils/closureCalendar';
import { frRange } from '../utils/calendarLayout';
import { formatPlatformLabel } from '../constants/platforms';

const TRACK_H = 32;
const HALF_GAP = 2;

/**
 * CalendarDayAgenda — the logement calendar on a phone (specs/calendar-property-parity.md rules 17, 21):
 * one month block of day rows, inside an InfiniteMonthScroller. A stay is a solid ribbon in the colour the
 * server chose (text colour included, nothing computed here): full width inside the stay, the right half on
 * the arrival day with « ↓ 16:00 », the left half on the departure day with « ↑ 10:00 », both halves on a
 * turnover day — the desktop's half-day geometry turned into a row. A stay that is over uses the soft tint, a
 * closure is a hatched ribbon « Fermé · … » halved the same way, a devis is a dashed grey ribbon. A free
 * future day offers « + Nouvelle réservation »; every row has a 44 px note button.
 *
 * Props:
 *  - year, month (0-based), today ('YYYY-MM-DD')
 *  - stays, closures: the payload of the month (stays carry label, platformDisplay, color, textColor, past)
 *  - devisList, selectedProp, calendarNotes, publicHolidays (Set), markersFor(dateStr)
 *  - onReservationClick(id), onDevisClick(id), onOpenNewReservation(start, end), onOpenNote(dateStr)
 */
function platformOf(stay) {
  return stay.platformDisplay || formatPlatformLabel(stay.platform);
}

// Palette of one ribbon: a current stay is solid, a past one soft, a closure hatched, a devis dashed.
function ribbonLook(theme, entry) {
  if (entry.kind === 'closure') {
    return {
      bgcolor: 'background.paper', backgroundImage: closureHatch(theme), color: 'text.primary',
      border: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.25), fontWeight: 600,
    };
  }
  if (entry.kind === 'devis') {
    return { bgcolor: 'grey.100', color: 'text.secondary', border: '1px dashed', borderColor: 'grey.500', fontWeight: 600 };
  }
  const { stay } = entry;
  return stay.past
    ? { bgcolor: barTint(stay.color), color: 'text.primary', boxShadow: `inset 3px 0 0 ${stay.color}` }
    : { bgcolor: stay.color, color: stay.textColor };
}

const SIDES = {
  full: { left: 0, right: 0 },
  right: { left: `calc(50% + ${HALF_GAP}px)`, right: 0, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  left: { left: 0, right: `calc(50% + ${HALF_GAP}px)`, borderTopRightRadius: 14, borderBottomRightRadius: 14 },
};

function Ribbon({ entry, side, text, time, onClick }) {
  const theme = useTheme();
  const clickable = Boolean(onClick);
  const props = clickable
    ? {
      role: 'button', tabIndex: 0,
      onClick,
      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
    }
    : { tabIndex: 0, role: 'img' };
  return (
    <Tooltip title={entry.tooltip} arrow enterTouchDelay={400}>
      <Box
        {...props}
        aria-label={entry.tooltip}
        data-ribbon={entry.key}
        data-side={side}
        sx={{
          position: 'absolute', top: 0, height: TRACK_H, borderRadius: '8px', ...SIDES[side],
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75, px: 1.1,
          fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
          cursor: clickable ? 'pointer' : 'default',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
          ...ribbonLook(theme, entry),
        }}
      >
        {text != null && <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</Box>}
        {time != null && <Box component="span" sx={{ flexShrink: 0, fontSize: 11.5, fontWeight: 500, opacity: 0.9 }}>{time}</Box>}
      </Box>
    </Tooltip>
  );
}

// What the empty half of a row says when a single stay or devis fills the other one.
function SideNote({ side, title, caption, onClick }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'absolute', top: -3, height: TRACK_H + 6, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minWidth: 0, lineHeight: 1.2, cursor: onClick ? 'pointer' : 'default',
        ...(side === 'left'
          ? { left: 0, right: `calc(50% + 6px)` }
          : { left: `calc(50% + 6px)`, right: 0, textAlign: 'right' }),
      }}
    >
      <Box component="span" sx={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Box>
      <Box component="span" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{caption}</Box>
    </Box>
  );
}

function stayEntry(stay, role) {
  return {
    kind: 'stay', key: `r${stay.id}-${role}`, stay,
    tooltip: `${stay.label} — ${platformOf(stay)}, ${frRange(stay.startDate, stay.endDate)}`,
  };
}

function closureEntry(closure) {
  return {
    kind: 'closure', key: `c${closure.id}`, closure,
    tooltip: `${closure.global ? 'Tout fermé' : `${closure.propertyName || 'Logement'} fermé`} — ${closure.label}, réouverture le ${frRange(closure.endDate, closure.endDate)}`,
  };
}

function devisEntry(devis, role) {
  return {
    kind: 'devis', key: `d${devis.id}-${role}`, devis,
    tooltip: `Devis — ${devis.firstName} ${devis.lastName}, ${frRange(devis.startDate, devis.endDate)}`,
  };
}

export default function CalendarDayAgenda({
  year, month, today, stays = [], closures = [], devisList = [], selectedProp,
  calendarNotes = {}, publicHolidays, markersFor = () => [],
  onReservationClick, onDevisClick, onOpenNewReservation, onOpenNote,
}) {
  const days = useMemo(
    () => Array.from({ length: getDaysInMonth(year, month) }, (_, i) => formatDate(year, month, i + 1)),
    [year, month],
  );

  return (
    <Box sx={{ pt: 0.5 }}>
      {days.map((dateStr) => {
        const summary = buildDaySummary(dateStr, stays, devisList);
        const closureDay = getClosureDayParts(dateStr, closures, selectedProp);
        const note = calendarNotes[dateStr];
        const isToday = dateStr === today;
        const isPast = dateStr < today;
        const markers = markersFor(dateStr);
        const date = new Date(`${dateStr}T12:00:00`);

        // Which ribbon fills which half of the row.
        let full = null;
        let left = null;
        let right = null;
        if (summary.ongoing) full = stayEntry(summary.ongoing, 'mid');
        else if (closureDay && closureDay.part === 'full') full = closureEntry(closureDay.closure);
        else {
          const ongoingDevis = summary.devis.find((d) => d.kind === 'ongoing');
          if (ongoingDevis) full = devisEntry(ongoingDevis.devis, 'mid');
          if (summary.departure) left = stayEntry(summary.departure, 'dep');
          else if (closureDay && closureDay.part === 'end') left = closureEntry(closureDay.closure);
          else { const d = summary.devis.find((x) => x.kind === 'departure'); if (d) left = devisEntry(d.devis, 'dep'); }
          if (summary.arrival) right = stayEntry(summary.arrival, 'arr');
          else if (closureDay && closureDay.part === 'start') right = closureEntry(closureDay.closure);
          else { const d = summary.devis.find((x) => x.kind === 'arrival'); if (d) right = devisEntry(d.devis, 'arr'); }
        }
        const free = !full && !left && !right && isEmptyDay(summary);
        const turnover = Boolean(left && right);

        const open = (entry) => {
          if (entry.kind === 'stay') return () => onReservationClick(entry.stay.id);
          if (entry.kind === 'devis') return () => onDevisClick(entry.devis.id);
          return undefined;
        };
        const nameOf = (entry) => (entry.kind === 'stay' ? entry.stay.label : entry.kind === 'devis' ? `${entry.devis.firstName} ${entry.devis.lastName}`.trim() : '');
        const timeOf = (entry, arrival) => {
          if (entry.kind !== 'stay') return null;
          return arrival ? `↓ ${entry.stay.checkInTime || '15:00'}` : `↑ ${entry.stay.checkOutTime || '10:00'}`;
        };
        // A half ribbon alone: the other half names it. On a turnover each ribbon carries its own name.
        const halfRibbon = (entry, side) => {
          const arrival = side === 'right';
          if (entry.kind === 'closure') {
            return <Ribbon entry={entry} side={side} text={arrival ? `Fermé · ${entry.closure.label}` : 'Fermé'} />;
          }
          return (
            <Ribbon
              entry={entry}
              side={side}
              text={turnover ? nameOf(entry) : (entry.kind === 'devis' ? 'Devis' : null)}
              time={timeOf(entry, arrival)}
              onClick={open(entry)}
            />
          );
        };
        const sideNote = (entry, side) => {
          if (turnover || entry.kind === 'closure') return null;
          const caption = entry.kind === 'stay'
            ? `${side === 'left' ? 'Arrivée' : 'Départ'} · ${platformOf(entry.stay)}`
            : 'Devis';
          return <SideNote side={side} title={nameOf(entry)} caption={caption} onClick={open(entry)} />;
        };

        return (
          <Box
            key={dateStr}
            data-day={dateStr}
            data-today={isToday ? 'true' : undefined}
            aria-current={isToday ? 'date' : undefined}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 0.75, my: 0.75, minHeight: 56, borderRadius: 2.5,
              bgcolor: isToday ? (t) => alpha(t.palette.primary.main, 0.08) : 'background.paper',
              border: '1px solid', borderColor: isToday ? 'primary.main' : 'divider', borderWidth: isToday ? 2 : 1,
              opacity: isPast && free ? 0.55 : 1,
            }}
          >
            <Box sx={{ width: 44, flexShrink: 0, textAlign: 'center', lineHeight: 1.05 }}>
              <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: 11 }}>
                {DAY_NAMES[(date.getDay() + 6) % 7]}
              </Typography>
              <Typography component="span" sx={{ display: 'block', fontSize: 20, fontWeight: isToday ? 800 : 600, fontVariantNumeric: 'tabular-nums', color: isToday ? 'primary.main' : 'text.primary' }}>
                {date.getDate()}
              </Typography>
              {publicHolidays && publicHolidays.has(dateStr) && (
                <Typography component="span" sx={{ display: 'block', fontSize: 10, color: 'error.main', fontWeight: 600 }}>férié</Typography>
              )}
              {markers.length > 0 && (
                <Box component="span" sx={{ display: 'flex', gap: '3px', justifyContent: 'center', mt: 0.25 }}>
                  {markers.map((mk) => <Box key={mk.key} component="span" title={mk.title} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: mk.color }} />)}
                </Box>
              )}
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              {free ? (
                <Box
                  onClick={!isPast ? () => onOpenNewReservation(dateStr, shiftDate(dateStr, 1)) : undefined}
                  role={!isPast ? 'button' : undefined}
                  tabIndex={!isPast ? 0 : undefined}
                  onKeyDown={!isPast ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenNewReservation(dateStr, shiftDate(dateStr, 1)); } } : undefined}
                  sx={{ display: 'flex', alignItems: 'center', minHeight: 44, color: 'text.secondary', cursor: isPast ? 'default' : 'pointer', fontSize: 13 }}
                >
                  {isPast ? '—' : '+ Nouvelle réservation'}
                </Box>
              ) : (
                <Box sx={{ position: 'relative', height: TRACK_H, my: 0.5 }}>
                  {full && (
                    <Ribbon
                      entry={full}
                      side="full"
                      text={full.kind === 'closure' ? `Fermé · ${full.closure.label}` : nameOf(full)}
                      time={full.kind === 'stay' ? platformOf(full.stay) : null}
                      onClick={open(full)}
                    />
                  )}
                  {left && halfRibbon(left, 'left')}
                  {right && halfRibbon(right, 'right')}
                  {left && !right && sideNote(left, 'right')}
                  {right && !left && sideNote(right, 'left')}
                </Box>
              )}
              {note && (
                <Typography variant="caption" sx={{ display: 'block', fontStyle: 'italic', color: 'text.secondary', mt: 0.25 }}>
                  {note}
                </Typography>
              )}
            </Box>

            <IconButton
              onClick={() => onOpenNote(dateStr)}
              aria-label={`Note du ${frRange(dateStr, dateStr)}`}
              sx={{ width: 44, height: 44, flexShrink: 0, color: note ? 'primary.main' : 'text.secondary' }}
            >
              <EditNoteIcon />
            </IconButton>
          </Box>
        );
      })}
    </Box>
  );
}
