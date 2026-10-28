import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { getClosureDayParts } from '../utils/closureCalendar';
import {
  formatDate, shiftDate, timeToHour, hourToPercent,
  getBlockedNightInfo, compactName, closureHatch,
  CLEANING_COLOR, BLOCKED_NIGHT_COLOR,
} from '../utils/calendarVisuals';
import { formatPlatformLabel } from '../constants/platforms';

// A devis label is three short lines in a fixed-height flex column: it must never be shrunk (the 3.9 px
// name of 2026-10-28 was a flex child with `overflow: hidden`), only cut by width.
const NO_SHRINK = { flexShrink: 0, maxWidth: '100%', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' };

// The row of a cell that holds the day number, the « férié » marker, the note and the zone dots.
// Stay names are drawn below it, by the grid (specs/calendar-property-parity.md rule 20).
export const CELL_TOP_BAND_H = 22;

/**
 * CalendarDayCell — renders a single day of the logement calendar: the diagonal check-in / check-out /
 * cleaning gradients, blocked-night bands, devis overlay, closure hatching (half a day at its start and
 * at its reopening, specs/calendar-property-parity.md rule 12), a top band with the day number, holiday
 * marker, calendar note and zone dots, and the click-zone hit-testing. Stay names are NOT drawn here:
 * the grid lays one ribbon per week segment over the cells.
 *
 * Props: day, y, m (coordinates of the day itself — an edge day of a block carries its own month);
 * outside (the day belongs to the neighbouring month: dimmed, still interactive);
 * reservations (the payload's stays: color / textColor decided by the server), devisList, closures,
 * selectedProp, calendarNotes, publicHolidays (Set of YYYY-MM-DD), markersFor(dateStr) → [{ key, color, title }]
 * (the plugins' day dots, hooks/useDayMarkers), today, cleaningHours, inDrag, isDragging;
 * callbacks onReservationClick(id), onMouseDown(day,y,m), onMouseEnter(day,y,m), onOpenNote(dateStr),
 * onOpenNewReservation(start,end), onDevisClick(devisId).
 */
const NOTE_FALLBACK = {};
const NO_MARKERS = () => [];

export default function CalendarDayCell({
  day, y, m, outside = false,
  reservations, devisList, closures, selectedProp,
  calendarNotes = NOTE_FALLBACK, publicHolidays, markersFor = NO_MARKERS,
  today, cleaningHours, inDrag, isDragging,
  onReservationClick, onMouseDown, onMouseEnter, onOpenNote, onOpenNewReservation, onDevisClick,
}) {
  // Gradient stops are plain CSS strings, so the cell needs concrete color VALUES from the theme
  // (sx token strings can't reach inside `linear-gradient(...)`).
  const theme = useTheme();
  const white = theme.palette.common.white;
  const dragColor = theme.palette.primary.light;
  const devisColor = theme.palette.grey[400];
  const baseColor = theme.palette.grey[100];
  const hatch = closureHatch(theme);

  const dateStr = formatDate(y, m, day);
  const isPast = dateStr < today;
  const isToday = dateStr === today;
  const opacity = (isPast ? 0.5 : 1) * (outside ? 0.7 : 1);

  // The top band: day number, « férié », the day's note (cut by width, full text on hover), zone dots.
  const renderTopBand = ({ color = 'text.primary', holidayColor = 'error.main', glow = false } = {}) => {
    const markers = markersFor(dateStr);
    const note = calendarNotes[dateStr];
    return (
      <Box
        sx={{
          position: 'absolute', top: 3, left: 6, right: 6, height: CELL_TOP_BAND_H - 6, zIndex: 3, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 0.75, color, lineHeight: 1, fontSize: 12,
          ...(glow ? { textShadow: `0 0 3px ${alpha(white, 0.8)}` } : {}),
        }}
      >
        <Box component="span" sx={{ fontWeight: isToday ? 800 : 600, flexShrink: 0 }}>{day}</Box>
        {publicHolidays.has(dateStr) && (
          <Box component="span" sx={{ color: holidayColor, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>férié</Box>
        )}
        {note ? (
          <Box
            component="span"
            title={note}
            sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontStyle: 'italic', fontWeight: 600, pointerEvents: 'auto' }}
          >
            {note}
          </Box>
        ) : <Box component="span" sx={{ flex: 1 }} />}
        {markers.length > 0 && (
          <Box component="span" sx={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            {markers.map((mk) => (
              <Box key={mk.key} title={mk.title} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: mk.color }} />
            ))}
          </Box>
        )}
      </Box>
    );
  };

  const cellBorder = (t) => (isToday ? `3px solid ${t.palette.primary.main}` : `1px solid ${t.palette.divider}`);

  // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
  const departureRes = reservations.find((r) => r.endDate === dateStr);
  const arrivalRes = reservations.find((r) => r.startDate === dateStr);
  const midRes = reservations.find((r) => dateStr > r.startDate && dateStr < r.endDate);
  const blockedNightInfo = getBlockedNightInfo(dateStr, reservations);
  const closureDay = getClosureDayParts(dateStr, closures, selectedProp);

  // Devis (quotes) — shown as faded overlay when no reservation is present
  const midDevis = !midRes && !departureRes && !arrivalRes
    ? devisList.find((d) => dateStr > d.startDate && dateStr < d.endDate)
    : null;
  const arrivalDevis = !arrivalRes && !midRes
    ? devisList.find((d) => d.startDate === dateStr)
    : null;
  const departureDevis = !departureRes && !midRes
    ? devisList.find((d) => d.endDate === dateStr)
    : null;

  // If mid-stay: full color fill (the ribbon over the cell carries the name)
  if (midRes) {
    return (
      <Box data-date={dateStr} onClick={() => onReservationClick(midRes.id)} onContextMenu={(e) => { e.preventDefault(); onOpenNote(dateStr); }} sx={{
        borderRadius: 1, position: 'relative', cursor: 'pointer', overflow: 'hidden',
        bgcolor: midRes.color, minHeight: 64, height: 64, boxSizing: 'border-box',
        opacity,
        border: (t) => (isToday ? `3px solid ${t.palette.primary.main}` : 'none'),
        transition: 'border 0.2s',
      }}>
        {renderTopBand({ color: midRes.textColor, holidayColor: midRes.textColor })}
      </Box>
    );
  }

  // Compute departure and arrival percentages + cleaning
  const checkOutHour = departureRes ? timeToHour(departureRes.checkOutTime || '10:00') : null;
  const checkInHour = arrivalRes ? timeToHour(arrivalRes.checkInTime || '15:00') : null;

  const departPct = checkOutHour !== null ? hourToPercent(checkOutHour) : null;
  const cleanEndHour = checkOutHour !== null ? checkOutHour + cleaningHours : null;
  const cleanEndPct = cleanEndHour !== null ? hourToPercent(cleanEndHour) : null;
  const arrivePct = checkInHour !== null ? hourToPercent(checkInHour) : null;
  const isLateDepartureEvening = blockedNightInfo?.type === 'late-departure-evening' && blockedNightInfo.client?.id === departureRes?.id;
  const hasEarlyBlockedNight = blockedNightInfo?.type === 'early-arrival';
  const isEarlyArrivalDay = Boolean(arrivalRes && checkInHour !== null && checkInHour <= 10);

  const partialClosure = closureDay && closureDay.part !== 'full' ? closureDay : null;
  const hasVisual = departPct !== null || arrivePct !== null || Boolean(blockedNightInfo) || Boolean(partialClosure);

  // Empty or drag-only day
  if (!hasVisual) {
    // Render devis (quote) as faded background when no reservation
    const activeDevis = midDevis || arrivalDevis || departureDevis;
    if (activeDevis && !inDrag) {
      const isArrival = Boolean(arrivalDevis);
      const isDeparture = Boolean(departureDevis);
      const resStart = new Date(activeDevis.startDate);
      const resEnd = new Date(activeDevis.endDate);
      const totalDays = Math.max(1, Math.round((resEnd - resStart) / 86400000));
      const midDate = new Date(resStart);
      midDate.setDate(midDate.getDate() + Math.round(totalDays / 2));
      const midDateStr = formatDate(midDate.getFullYear(), midDate.getMonth(), midDate.getDate());
      const isLabelDay = dateStr === midDateStr;
      return (
        <Box
          data-date={dateStr}
          onClick={() => onDevisClick(activeDevis.id)}
          sx={{
            textAlign: 'center', pt: `${CELL_TOP_BAND_H - 4}px`, borderRadius: 1, position: 'relative', cursor: 'pointer',
            bgcolor: devisColor, color: 'common.white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64, height: 64, boxSizing: 'border-box',
            opacity,
            border: (t) => (isToday ? `3px solid ${t.palette.primary.main}` : 'none'),
            transition: 'border 0.2s',
            background: isArrival
              ? `linear-gradient(135deg, transparent 0%, transparent 49.5%, ${devisColor} 50%, ${devisColor} 100%)`
              : isDeparture
                ? `linear-gradient(135deg, ${devisColor} 0%, ${devisColor} 50%, transparent 50.5%, transparent 100%)`
                : devisColor,
          }}
        >
          {renderTopBand({ color: 'common.white', holidayColor: 'common.white' })}
          {isLabelDay && (
            <>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: alpha(white, 0.85), ...NO_SHRINK }}>
                devis
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'common.white', px: 0.5, ...NO_SHRINK }}>
                {activeDevis.firstName} {activeDevis.lastName}
              </Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: alpha(white, 0.85), ...NO_SHRINK }}>
                {formatPlatformLabel(activeDevis.platform) || '-'}
              </Typography>
            </>
          )}
        </Box>
      );
    }
    const closure = closureDay ? closureDay.closure : null;
    const cellNode = (
      <Box data-date={dateStr}
        onMouseDown={() => !isPast && onMouseDown(day, y, m)}
        onMouseEnter={() => onMouseEnter(day, y, m)}
        onContextMenu={(e) => { e.preventDefault(); onOpenNote(dateStr); }}
        sx={{
          borderRadius: 1, position: 'relative', minHeight: 64,
          height: 64, boxSizing: 'border-box',
          cursor: isPast || closure ? 'default' : 'pointer', fontSize: 14,
          bgcolor: isPast ? 'grey.300' : inDrag ? 'primary.light' : 'grey.100',
          color: isPast ? 'grey.500' : inDrag ? 'common.white' : 'text.primary',
          fontWeight: inDrag ? 600 : 400,
          border: (t) => (isToday ? `3px solid ${t.palette.primary.main}` : 'none'),
          ...(!isPast && !closure && { '&:hover': { bgcolor: 'primary.light', color: 'common.white' } }),
          transition: 'background-color 0.15s, border 0.2s',
          opacity: outside ? 0.7 : 1,
          ...(closure ? {
            backgroundImage: hatch,
            borderTop: '1px dashed',
            borderBottom: '1px dashed',
            borderColor: 'grey.500',
          } : {}),
        }}
      >
        {renderTopBand({ color: 'inherit', holidayColor: inDrag ? 'common.white' : 'error.main' })}
        {closure && (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              left: 0, right: 0, bottom: 6,
              fontStyle: 'italic', color: 'text.secondary', fontSize: 11, textAlign: 'center',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              px: 0.5,
            }}
          >
            {closure.label || 'Fermé'}
          </Typography>
        )}
      </Box>
    );
    return closure ? (
      <Tooltip
        title={`${closure.label || 'Fermeture'} — du ${closure.startDate} au ${closure.endDate}`}
        arrow
      >
        {cellNode}
      </Tooltip>
    ) : cellNode;
  }

  // Build gradient stops for the diagonal fill
  const departColor = departureRes ? departureRes.color : null;
  const arriveColor = arrivalRes ? arrivalRes.color : null;
  const stops = [];
  const gapColor = inDrag ? dragColor : 'transparent';

  if (departPct !== null) {
    stops.push(`${departColor} 0%`);
    stops.push(`${departColor} ${departPct}%`);
    const postDepartureColor = isLateDepartureEvening ? BLOCKED_NIGHT_COLOR : CLEANING_COLOR;
    if (cleanEndPct !== null && cleanEndPct > departPct && !isLateDepartureEvening) {
      stops.push(`${postDepartureColor} ${departPct}%`);
      stops.push(`${postDepartureColor} ${Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)}%`);
      const cleanStop = Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100);
      if (arrivePct !== null && arrivePct > cleanStop) {
        stops.push(`${gapColor} ${cleanStop}%`);
        stops.push(`${gapColor} ${arrivePct}%`);
      } else if (arrivePct === null) {
        if (hasEarlyBlockedNight) {
          stops.push(`${gapColor} ${cleanStop}%`);
          stops.push(`${gapColor} ${blockedNightInfo.startPct}%`);
          stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
          stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
        } else {
          stops.push(`${gapColor} ${cleanStop}%`);
          stops.push(`${gapColor} 100%`);
        }
      }
    } else {
      if (isLateDepartureEvening) {
        stops.push(`${postDepartureColor} ${departPct}%`);
        stops.push(`${postDepartureColor} 100%`);
      } else if (arrivePct !== null && arrivePct > departPct) {
        stops.push(`${gapColor} ${departPct}%`);
        stops.push(`${gapColor} ${arrivePct}%`);
      } else if (arrivePct === null) {
        if (hasEarlyBlockedNight) {
          stops.push(`${gapColor} ${departPct}%`);
          stops.push(`${gapColor} ${blockedNightInfo.startPct}%`);
          stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
          stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
        } else {
          stops.push(`${gapColor} ${departPct}%`);
          stops.push(`${gapColor} 100%`);
        }
      }
    }
  }

  if (arrivePct !== null) {
    if (departPct === null) {
      const freeColor = isEarlyArrivalDay ? BLOCKED_NIGHT_COLOR : (inDrag ? dragColor : 'transparent');
      stops.push(`${freeColor} 0%`);
      stops.push(`${freeColor} ${arrivePct}%`);
    }
    stops.push(`${arriveColor} ${arrivePct}%`);
    stops.push(`${arriveColor} 100%`);
  }

  if (blockedNightInfo && !departureRes && !arrivalRes) {
    if (blockedNightInfo.type === 'early-arrival') {
      const freeColor = inDrag ? dragColor : 'transparent';
      stops.length = 0;
      stops.push(`${freeColor} 0%`);
      stops.push(`${freeColor} ${blockedNightInfo.startPct}%`);
      stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.startPct}%`);
      stops.push(`${BLOCKED_NIGHT_COLOR} 100%`);
    } else if (blockedNightInfo.type === 'late-departure-morning') {
      const cleaningStartPct = blockedNightInfo.endPct;
      const nextDayCleaningEndPct = hourToPercent(10 + cleaningHours);
      stops.length = 0;
      stops.push(`${BLOCKED_NIGHT_COLOR} 0%`);
      stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedNightInfo.endPct}%`);
      if (nextDayCleaningEndPct > cleaningStartPct) {
        stops.push(`${CLEANING_COLOR} ${cleaningStartPct}%`);
        stops.push(`${CLEANING_COLOR} ${Math.min(nextDayCleaningEndPct, 100)}%`);
      }
      if (nextDayCleaningEndPct < 100) {
        stops.push(`${gapColor} ${Math.min(nextDayCleaningEndPct, 100)}%`);
        stops.push(`${gapColor} 100%`);
      }
    }
  }

  // Layers, top first: the stays' diagonal, then — for a closure that starts or reopens on this day — a
  // plain half that masks the hatching it must not cover, then the hatching itself.
  const layers = [];
  if (stops.length > 0) layers.push(`linear-gradient(135deg, ${stops.join(', ')})`);
  if (partialClosure) {
    const cover = inDrag ? dragColor : baseColor;
    layers.push(partialClosure.part === 'start'
      ? `linear-gradient(135deg, ${cover} 0 50%, transparent 50%)`
      : `linear-gradient(135deg, transparent 0 50%, ${cover} 50%)`);
    layers.push(hatch);
  }

  // Boundary between departure/cleaning zone and free zone (for click detection)
  const blockedZoneStartPct = blockedNightInfo && blockedNightInfo.type !== 'late-departure-morning'
    ? blockedNightInfo.startPct
    : null;
  const blockedZoneEndPct = blockedNightInfo && blockedNightInfo.type !== 'late-departure-morning'
    ? 100
    : null;
  const arrivalBlockedZoneEndPct = isEarlyArrivalDay ? arrivePct : null;

  const departEndPct = departPct !== null
    ? (isLateDepartureEvening
      ? departPct
      : (cleanEndPct !== null && cleanEndPct > departPct
      ? Math.min(cleanEndPct, arrivePct !== null ? arrivePct : 100)
      : departPct))
    : 0;

  const tooltipParts = [];
  if (departureRes) tooltipParts.push(`Départ: ${departureRes.firstName} ${departureRes.lastName} à ${departureRes.checkOutTime || '10:00'}`);
  if (departureRes) tooltipParts.push(`Ménage: ${cleaningHours}h`);
  if (arrivalRes) tooltipParts.push(`Arrivée: ${arrivalRes.firstName} ${arrivalRes.lastName} à ${arrivalRes.checkInTime || '15:00'}`);
  if (isEarlyArrivalDay) tooltipParts.push(`Nuit bloquée avant arrivée anticipée de ${arrivalRes.firstName} ${arrivalRes.lastName}`);
  if (blockedNightInfo?.type === 'early-arrival') tooltipParts.push(`Nuit bloquée: arrivée anticipée de ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);
  if (blockedNightInfo?.type === 'late-departure-evening') tooltipParts.push(`Nuit bloquée: départ tardif de ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);
  if (blockedNightInfo?.type === 'late-departure-morning') tooltipParts.push(`Nuit bloquée puis ménage pour ${blockedNightInfo.client.firstName} ${blockedNightInfo.client.lastName}`);
  if (partialClosure) {
    tooltipParts.push(`${partialClosure.closure.label || 'Fermeture'} — ${partialClosure.part === 'start' ? 'fermé à partir du milieu de la journée' : 'rouvre au milieu de la journée'}`);
  }

  // Compute click zone from cursor position on the 135deg gradient
  const getClickPct = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) + (e.clientY - rect.top)) / (rect.width + rect.height) * 100;
  };
  // The closed half of a closure day: the second half on its first day, the first half on its reopening day.
  const onClosedZone = (pct) => Boolean(partialClosure) && (partialClosure.part === 'start' ? pct >= 50 : pct <= 50);

  return (
    <Box data-date={dateStr}
      onMouseDown={(e) => {
        if (isPast) return;
        const pct = getClickPct(e);
        const onDepartZone = departureRes && pct <= departEndPct;
        const onArriveZone = arrivalRes && pct >= arrivePct;
        const onBlockedZone = blockedNightInfo && blockedZoneStartPct !== null && blockedZoneEndPct !== null && pct >= blockedZoneStartPct && pct <= blockedZoneEndPct;
        const onArrivalBlockedZone = isEarlyArrivalDay && arrivalBlockedZoneEndPct !== null && pct <= arrivalBlockedZoneEndPct;
        if (!onDepartZone && !onArriveZone && !onBlockedZone && !onArrivalBlockedZone && !onClosedZone(pct)) {
          onMouseDown(day, y, m);
        }
      }}
      onMouseEnter={() => onMouseEnter(day, y, m)}
      onContextMenu={(e) => { e.preventDefault(); onOpenNote(dateStr); }}
      onClick={async (e) => {
        if (isDragging) return;
        const pct = getClickPct(e);
        const onBlockedZone = blockedNightInfo && blockedZoneStartPct !== null && blockedZoneEndPct !== null && pct >= blockedZoneStartPct && pct <= blockedZoneEndPct;
        const onArrivalBlockedZone = isEarlyArrivalDay && arrivalBlockedZoneEndPct !== null && pct <= arrivalBlockedZoneEndPct;
        if (onArrivalBlockedZone && arrivalRes) {
          onReservationClick(arrivalRes.id);
        } else if (onBlockedZone && blockedNightInfo?.client) {
          onReservationClick(blockedNightInfo.client.id);
        } else if (departureRes && pct <= departEndPct) {
          onReservationClick(departureRes.id);
        } else if (arrivalRes && pct >= arrivePct) {
          onReservationClick(arrivalRes.id);
        } else if (onClosedZone(pct)) {
          // A closure never opens a fiche.
        } else if (departureRes && !arrivalRes) {
          // Free zone on departure-only day: create new reservation
          const startDate = formatDate(y, m, day);
          const endDate = shiftDate(startDate, 1);
          onOpenNewReservation(startDate, endDate);
        } else if (!departureRes && arrivalRes) {
          // Free zone on arrival-only day: show arrival reservation
          onReservationClick(arrivalRes.id);
        }
      }}
      title={tooltipParts.join('\n')}
      sx={{
        borderRadius: 1, position: 'relative', minHeight: 64,
        height: 64, boxSizing: 'border-box',
        cursor: 'pointer', fontSize: 14, fontWeight: 600,
        backgroundColor: 'grey.100',
        backgroundImage: layers.length > 0 ? layers.join(', ') : undefined,
        // Clip the gradient to the padding box so the colored fill never bleeds under the
        // translucent divider border and shows through it as a colored rim.
        backgroundClip: 'padding-box',
        border: cellBorder,
        color: 'text.primary', overflow: 'hidden',
        opacity,
        transition: 'border 0.2s',
      }}
    >
      {renderTopBand({ glow: true })}
      {blockedNightInfo?.client && !departureRes && !arrivalRes && (
        <Box sx={{ position: 'absolute', bottom: 3, right: 4, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'text.primary', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {compactName(blockedNightInfo.client.firstName, blockedNightInfo.client.lastName)}
          </Typography>
          <Typography sx={{ fontSize: 9, fontWeight: 500, color: 'text.secondary', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {blockedNightInfo.type === 'early-arrival' ? 'arrivée anticipée' : 'nuit bloquée'}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
