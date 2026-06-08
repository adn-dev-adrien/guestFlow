/**
 * CalendarWeekView — mobile (xs) reservation calendar (specs/calendar-mobile-view.md).
 *
 * One week per full-width page in a horizontal scroll-snap strip: swipe left/right to move
 * between weeks. Each week shows its 7 days as full-width vertical rows with readable labels
 * (arrival / departure / ongoing stay / devis / closure / note) instead of the desktop
 * diagonal-gradient grid. Desktop keeps CalendarMonthGrid.
 *
 * Props:
 *  - today: 'YYYY-MM-DD'
 *  - reservations, devisList, closures, calendarNotes, publicHolidays (Set), schoolHolidays
 *  - selectedProp
 *  - onReservationClick(id), onDevisClick(id), onOpenNewReservation(start,end), onOpenNote(dateStr)
 *  - onWeekChange(weekStartStr): lets the parent extend the loaded month range to cover the week.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Box, Typography, IconButton, Button, Chip, Stack } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { formatDate, shiftDate, getReservationColor, compactName, DAY_NAMES, MONTH_NAMES, ZONE_COLORS } from '../utils/calendarVisuals';
import { getClosureForDate } from '../utils/closureCalendar';
import { getSchoolHolidayInfo } from '../frenchHolidays';
import { buildDaySummary, isEmptyDay, getMonday, weekDays } from '../utils/calendarDaySummary';

const WEEKS_EACH_SIDE = 26;
const CENTER = WEEKS_EACH_SIDE;

function toStr(d) { return formatDate(d.getFullYear(), d.getMonth(), d.getDate()); }

function weekLabel(monday) {
  const days = weekDays(monday);
  const s = days[0];
  const e = days[6];
  const sM = MONTH_NAMES[s.getMonth()].toLowerCase();
  const eM = MONTH_NAMES[e.getMonth()].toLowerCase();
  if (s.getMonth() === e.getMonth()) {
    return `${s.getDate()} – ${e.getDate()} ${eM} ${e.getFullYear()}`;
  }
  return `${s.getDate()} ${sM} – ${e.getDate()} ${eM} ${e.getFullYear()}`;
}

function EventLine({ color, icon, primary, secondary, onClick, faded }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, borderRadius: 1,
        cursor: onClick ? 'pointer' : 'default', minHeight: 36,
        bgcolor: faded ? 'grey.100' : 'transparent',
        borderLeft: '4px solid', borderColor: color,
      }}
    >
      <Typography sx={{ fontSize: 16, lineHeight: 1, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {primary}
        </Typography>
        {secondary && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>{secondary}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default function CalendarWeekView({
  today, reservations = [], devisList = [], closures = [], selectedProp,
  calendarNotes = {}, publicHolidays, schoolHolidays = [],
  onReservationClick, onDevisClick, onOpenNewReservation, onOpenNote, onWeekChange,
}) {
  const todayDate = useMemo(() => new Date(`${today}T00:00:00`), [today]);
  const pivotMonday = useMemo(() => getMonday(todayDate), [todayDate]);

  const weekMondays = useMemo(
    () => Array.from({ length: WEEKS_EACH_SIDE * 2 + 1 }, (_, i) => {
      const d = new Date(pivotMonday.getFullYear(), pivotMonday.getMonth(), pivotMonday.getDate() + (i - CENTER) * 7);
      return d;
    }),
    [pivotMonday],
  );

  const scrollRef = useRef(null);
  const [index, setIndex] = useState(CENTER);

  // Land on today's week on mount (and whenever the pivot resets).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = CENTER * el.clientWidth;
    setIndex(CENTER);
  }, [pivotMonday]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== index && idx >= 0 && idx < weekMondays.length) {
      setIndex(idx);
      if (onWeekChange) onWeekChange(toStr(weekMondays[idx]));
    }
  }, [index, weekMondays, onWeekChange]);

  const goTo = useCallback((idx) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  }, []);

  const renderDay = (date) => {
    const dateStr = toStr(date);
    const summary = buildDaySummary(dateStr, reservations, devisList);
    const closure = getClosureForDate(dateStr, closures, selectedProp);
    const note = calendarNotes[dateStr];
    const isToday = dateStr === today;
    const isPast = dateStr < today;
    const isPublicHoliday = publicHolidays?.has?.(dateStr);
    const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
    const empty = isEmptyDay(summary) && !closure;

    return (
      <Box
        key={dateStr}
        sx={{
          display: 'flex', gap: 1, p: 1, borderRadius: 1, minHeight: 56,
          border: '1px solid', borderColor: isToday ? 'primary.main' : 'divider',
          bgcolor: isToday ? 'primary.lighter' : 'background.paper',
          opacity: isPast ? 0.6 : 1,
        }}
      >
        {/* Date column */}
        <Box sx={{ width: 46, flexShrink: 0, textAlign: 'center' }}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1 }}>
            {DAY_NAMES[(date.getDay() + 6) % 7]}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: isToday ? 700 : 500, lineHeight: 1.2, color: isToday ? 'primary.main' : 'text.primary' }}>
            {date.getDate()}
          </Typography>
          <Stack direction="row" spacing={0.3} sx={{ justifyContent: 'center', mt: 0.25 }}>
            {isPublicHoliday && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#d32f2f' }} />}
            {schoolInfo?.zones?.map((z) => (
              <Box key={z} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ZONE_COLORS[z] }} />
            ))}
          </Stack>
        </Box>

        {/* Events column */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5, justifyContent: 'center' }}>
          {summary.departure && (
            <EventLine
              color={getReservationColor(summary.departure.platform)}
              icon="↓"
              primary={`Départ — ${compactName(summary.departure.firstName, summary.departure.lastName)}`}
              secondary={`${summary.departure.checkOutTime || '10:00'} · ${summary.departure.platform || ''}`}
              onClick={() => onReservationClick(summary.departure.id)}
            />
          )}
          {summary.arrival && (
            <EventLine
              color={getReservationColor(summary.arrival.platform)}
              icon="↑"
              primary={`Arrivée — ${compactName(summary.arrival.firstName, summary.arrival.lastName)}`}
              secondary={`${summary.arrival.checkInTime || '15:00'} · ${summary.arrival.platform || ''}`}
              onClick={() => onReservationClick(summary.arrival.id)}
            />
          )}
          {summary.ongoing && (
            <EventLine
              color={getReservationColor(summary.ongoing.platform)}
              icon="•"
              primary={`Séjour — ${compactName(summary.ongoing.firstName, summary.ongoing.lastName)}`}
              secondary={summary.ongoing.platform || ''}
              onClick={() => onReservationClick(summary.ongoing.id)}
            />
          )}
          {summary.devis.map(({ kind, devis }) => (
            <EventLine
              key={`devis-${devis.id}-${kind}`}
              color="#bdbdbd"
              faded
              icon={kind === 'arrival' ? '↑' : kind === 'departure' ? '↓' : '•'}
              primary={`Devis — ${compactName(devis.firstName, devis.lastName)}`}
              secondary={devis.platform || ''}
              onClick={() => onDevisClick(devis.id)}
            />
          ))}
          {closure && (
            <Chip size="small" variant="outlined" label={closure.label || 'Fermé'} sx={{ alignSelf: 'flex-start' }} />
          )}
          {note && (
            <Typography variant="caption" sx={{ fontStyle: 'italic', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <EditNoteIcon sx={{ fontSize: 14 }} /> {note}
            </Typography>
          )}
          {empty && (
            <Box
              onClick={() => !isPast && onOpenNewReservation(dateStr, shiftDate(dateStr, 1))}
              sx={{ display: 'flex', alignItems: 'center', minHeight: 28, color: 'text.disabled', cursor: isPast ? 'default' : 'pointer' }}
            >
              <Typography variant="caption">{isPast ? '—' : '+ Nouvelle réservation'}</Typography>
            </Box>
          )}
        </Box>

        {/* Note action */}
        <IconButton size="small" onClick={() => onOpenNote(dateStr)} aria-label="Note" sx={{ alignSelf: 'flex-start', flexShrink: 0 }}>
          <EditNoteIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  };

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {/* Week header + navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderBottom: '1px solid', borderColor: 'divider', position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 2 }}>
        <IconButton size="small" onClick={() => goTo(Math.max(0, index - 1))} aria-label="Semaine précédente">
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, textAlign: 'center' }}>
          {weekLabel(weekMondays[index] || pivotMonday)}
        </Typography>
        <IconButton size="small" onClick={() => goTo(Math.min(weekMondays.length - 1, index + 1))} aria-label="Semaine suivante">
          <ChevronRightIcon />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Button size="small" startIcon={<TodayIcon />} onClick={() => goTo(CENTER)}>Aujourd'hui</Button>
      </Box>

      {/* Horizontal scroll-snap strip of weeks */}
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{
          display: 'flex', overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none',
        }}
      >
        {weekMondays.map((monday, i) => (
          <Box
            key={toStr(monday)}
            sx={{ flex: '0 0 100%', scrollSnapAlign: 'start', boxSizing: 'border-box', p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}
          >
            {/* Render only the centered week ± 1 for perf; others are empty spacers. */}
            {Math.abs(i - index) <= 1 ? weekDays(monday).map(renderDay) : <Box sx={{ minHeight: 7 * 64 }} />}
          </Box>
        ))}
      </Box>
    </Card>
  );
}
