import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { getSchoolHolidayInfo } from '../frenchHolidays';
import { getClosureForDate } from '../utils/closureCalendar';
import {
  formatDate, shiftDate, timeToHour, hourToPercent, getReservationColor,
  getBlockedNightInfo, resHasMidDays, compactName,
  CLEANING_COLOR, BLOCKED_NIGHT_COLOR, ZONE_COLORS,
} from '../utils/calendarVisuals';

/**
 * CalendarDayCell — renders a single day of the reservation calendar (the diagonal
 * check-in/check-out/cleaning gradients, blocked-night bands, devis overlay, closures,
 * holiday/zone indicators, calendar-note label and the click-zone hit-testing).
 * Moved verbatim from CalendarPage; closed-over data/handlers are now props.
 *
 * Props: day, y, m, dim (coordinates); reservations, devisList, closures, selectedProp,
 * calendarNotes, publicHolidays (Set of YYYY-MM-DD), schoolHolidays, today, cleaningHours,
 * inDrag, isDragging; callbacks onReservationClick(id), onMouseDown(day,y,m),
 * onMouseEnter(day,y,m), onOpenNote(dateStr), onOpenNewReservation(start,end), onDevisClick(devisId).
 */
const NOTE_FALLBACK = {};

export default function CalendarDayCell({
  day, y, m, dim,
  reservations, devisList, closures, selectedProp,
  calendarNotes = NOTE_FALLBACK, publicHolidays, schoolHolidays,
  today, cleaningHours, inDrag, isDragging,
  onReservationClick, onMouseDown, onMouseEnter, onOpenNote, onOpenNewReservation, onDevisClick,
}) {
  const renderHolidayIndicators = (dateStr) => {
    const isPublicHoliday = publicHolidays.has(dateStr);
    const schoolInfo = getSchoolHolidayInfo(dateStr, schoolHolidays);
    return (
      <>
        {isPublicHoliday && (
          <Typography sx={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', fontSize: 14, color: '#d32f2f', zIndex: 3, pointerEvents: 'none', lineHeight: 1, opacity: 0.7, whiteSpace: 'nowrap' }}>férié</Typography>
        )}
        {schoolInfo && (
          <Box sx={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '3px', zIndex: 3, pointerEvents: 'none' }}>
            {schoolInfo.zones.map((z) => (
              <Box key={z} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ZONE_COLORS[z] }} />
            ))}
          </Box>
        )}
      </>
    );
  };

  const renderNoteLabel = (dateStr, hasReservation) => {
    const note = calendarNotes[dateStr];
    if (!note) return null;
    const fontSize = hasReservation ? 8 : 10;
    return (
      <Typography title={note} sx={{
        position: 'absolute', bottom: hasReservation ? 14 : 16, left: '50%', transform: 'translateX(-50%)',
        fontSize, lineHeight: 1.1, color: hasReservation ? 'rgba(255,255,255,0.9)' : '#1a1a1a',
        zIndex: 2, pointerEvents: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '90%', fontStyle: 'italic', fontWeight: 600,
        textShadow: hasReservation ? '0 0 2px rgba(0,0,0,0.5)' : 'none',
      }}>
        {note}
      </Typography>
    );
  };

  const dateStr = formatDate(y, m, day);
  const isPast = dateStr < today;

  // Find departure (endDate === this day), arrival (startDate === this day), mid-stay
  const departureRes = reservations.find((r) => r.endDate === dateStr);
  const arrivalRes = reservations.find((r) => r.startDate === dateStr);
  const midRes = reservations.find((r) => dateStr > r.startDate && dateStr < r.endDate);
  const blockedNightInfo = getBlockedNightInfo(dateStr, reservations);

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

  // If mid-stay: full color fill
  if (midRes) {
    const color = getReservationColor(midRes.platform);
    const isToday = dateStr === today;
    // Show label on the true middle day of the entire reservation
    const resStart = new Date(midRes.startDate);
    const resEnd = new Date(midRes.endDate);
    const totalDays = Math.round((resEnd - resStart) / 86400000);
    const midDate = new Date(resStart);
    midDate.setDate(midDate.getDate() + Math.round(totalDays / 2));
    const midDateStr = formatDate(midDate.getFullYear(), midDate.getMonth(), midDate.getDate());
    const isLabelDay = dateStr === midDateStr;
    return (
      <Box data-date={dateStr} onClick={() => onReservationClick(midRes.id)} onContextMenu={(e) => { e.preventDefault(); onOpenNote(dateStr); }} sx={{
        textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', cursor: 'pointer',
        bgcolor: color, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64, height: 64, boxSizing: 'border-box',
        opacity: isPast ? 0.5 : 1,
        border: isToday ? '3px solid #1976d2' : 'none',
        transition: 'border 0.2s',
      }}>
        {renderHolidayIndicators(dateStr)}
        {renderNoteLabel(dateStr, true)}
        {isLabelDay ? (
          <>
            <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
              {midRes.firstName} {midRes.lastName}
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
              {midRes.platform}
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
        )}
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

  const hasVisual = departPct !== null || arrivePct !== null || Boolean(blockedNightInfo);

  // Empty or drag-only day
  if (!hasVisual) {
    const isToday = dateStr === today;

    // Render devis (quote) as faded background when no reservation
    const activeDevis = midDevis || arrivalDevis || departureDevis;
    if (activeDevis && !inDrag) {
      const devisColor = '#bdbdbd';
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
            textAlign: 'center', py: 1, borderRadius: 1, position: 'relative', cursor: 'pointer',
            bgcolor: devisColor, color: 'white', fontWeight: 600, fontSize: 14, overflow: 'hidden',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 64, height: 64, boxSizing: 'border-box',
            opacity: isPast ? 0.5 : 1,
            border: isToday ? '3px solid #1976d2' : 'none',
            transition: 'border 0.2s',
            background: isArrival
              ? `linear-gradient(135deg, transparent 0%, transparent 49.5%, ${devisColor} 50%, ${devisColor} 100%)`
              : isDeparture
                ? `linear-gradient(135deg, ${devisColor} 0%, ${devisColor} 50%, transparent 50.5%, transparent 100%)`
                : devisColor,
          }}
        >
          {renderHolidayIndicators(dateStr)}
          {renderNoteLabel(dateStr, true)}
          {isLabelDay && (
            <>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                devis
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, color: 'white', whiteSpace: 'nowrap' }}>
                {activeDevis.firstName} {activeDevis.lastName}
              </Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
                {activeDevis.platform || '-'}
              </Typography>
            </>
          )}
          {!isLabelDay && (
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{day}</Typography>
          )}
        </Box>
      );
    }
    const closure = getClosureForDate(dateStr, closures, selectedProp);
    const cellNode = (
      <Box data-date={dateStr}
        onMouseDown={() => !isPast && onMouseDown(day, y, m)}
        onMouseEnter={() => onMouseEnter(day, y, m)}
        onContextMenu={(e) => { e.preventDefault(); onOpenNote(dateStr); }}
        sx={{
          textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
          height: 64, boxSizing: 'border-box',
          cursor: isPast || closure ? 'default' : 'pointer', fontSize: 14,
          bgcolor: isPast ? 'grey.300' : inDrag ? 'primary.light' : 'grey.100',
          color: isPast ? 'grey.500' : inDrag ? 'white' : 'text.primary',
          fontWeight: inDrag ? 600 : 400,
          border: isToday ? '3px solid #1976d2' : 'none',
          ...(!isPast && !closure && { '&:hover': { bgcolor: 'primary.light', color: 'white' } }),
          transition: 'background-color 0.15s, border 0.2s',
          ...(closure ? {
            backgroundImage:
              'repeating-linear-gradient(135deg, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 8px, rgba(0,0,0,0.14) 8px, rgba(0,0,0,0.14) 16px)',
            borderTop: '1px dashed',
            borderBottom: '1px dashed',
            borderColor: 'grey.500',
          } : {}),
        }}
      >
        {renderHolidayIndicators(dateStr)}
        {renderNoteLabel(dateStr, false)}
        {closure ? (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
              fontStyle: 'italic', color: 'text.disabled', fontSize: 11,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              px: 0.5,
            }}
          >
            {closure.label || 'Fermé'}
          </Typography>
        ) : day}
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
  const departColor = departureRes ? getReservationColor(departureRes.platform) : null;
  const arriveColor = arrivalRes ? getReservationColor(arrivalRes.platform) : null;
  const stops = [];
  const gapColor = inDrag ? '#42a5f5' : 'transparent';

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
      const freeColor = isEarlyArrivalDay ? BLOCKED_NIGHT_COLOR : (inDrag ? '#42a5f5' : 'transparent');
      stops.push(`${freeColor} 0%`);
      stops.push(`${freeColor} ${arrivePct}%`);
    }
    stops.push(`${arriveColor} ${arrivePct}%`);
    stops.push(`${arriveColor} 100%`);
  }

  if (blockedNightInfo && !departureRes && !arrivalRes) {
    if (blockedNightInfo.type === 'early-arrival') {
      const freeColor = inDrag ? '#42a5f5' : 'transparent';
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

  const gradient = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : undefined;

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

  // Compute click zone from cursor position on the 135deg gradient
  const getClickPct = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) + (e.clientY - rect.top)) / (rect.width + rect.height) * 100;
  };

  return (
    <Box data-date={dateStr}
      onMouseDown={(e) => {
        if (isPast) return;
        const pct = getClickPct(e);
        const onDepartZone = departureRes && pct <= departEndPct;
        const onArriveZone = arrivalRes && pct >= arrivePct;
        const onBlockedZone = blockedNightInfo && blockedZoneStartPct !== null && blockedZoneEndPct !== null && pct >= blockedZoneStartPct && pct <= blockedZoneEndPct;
        const onArrivalBlockedZone = isEarlyArrivalDay && arrivalBlockedZoneEndPct !== null && pct <= arrivalBlockedZoneEndPct;
        if (!onDepartZone && !onArriveZone && !onBlockedZone && !onArrivalBlockedZone) {
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
        textAlign: 'center', py: 3, borderRadius: 1, position: 'relative', minHeight: 64,
        height: 64, boxSizing: 'border-box',
        cursor: 'pointer', fontSize: 14, fontWeight: 600,
        background: gradient || 'grey.100',
        border: dateStr === today ? '3px solid #1976d2' : '1px solid #e0e0e0',
        color: 'text.primary', overflow: 'hidden',
        opacity: isPast ? 0.5 : 1,
        transition: 'border 0.2s',
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1, textShadow: '0 0 3px rgba(255,255,255,0.8)' }}>
        {day}
      </Box>
      {renderHolidayIndicators(dateStr)}
      {renderNoteLabel(dateStr, !!(departureRes || arrivalRes || blockedNightInfo))}
      {blockedNightInfo?.client && !departureRes && !arrivalRes && (
        <Box sx={{ position: 'absolute', bottom: 1, right: 2, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
            {compactName(blockedNightInfo.client.firstName, blockedNightInfo.client.lastName)}
          </Typography>
          <Typography sx={{ fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.88)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
            {blockedNightInfo.type === 'early-arrival' ? 'arrivée anticipée' : 'nuit bloquée'}
          </Typography>
        </Box>
      )}
      {/* Compact label for arrival on short reservations (no mid-day visible) */}
      {arrivalRes && !resHasMidDays(arrivalRes, y, m, dim) && (() => {
        const colorPct = 100 - (arrivePct || 0);
        const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
        const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
        return (
          <Box sx={{ position: 'absolute', bottom: 1, right: 2, zIndex: 2, textAlign: 'right', lineHeight: 1, pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {compactName(arrivalRes.firstName, arrivalRes.lastName)}
            </Typography>
            <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {arrivalRes.platform}
            </Typography>
          </Box>
        );
      })()}
      {/* Compact label for departure on short reservations when arrival not in this month */}
      {departureRes && !resHasMidDays(departureRes, y, m, dim) && !(departureRes.startDate >= formatDate(y, m, 1) && departureRes.startDate <= formatDate(y, m, dim)) && (() => {
        const colorPct = departEndPct || departPct || 0;
        const nameSize = Math.max(10, Math.round(colorPct / 100 * 28));
        const platSize = Math.max(9, Math.round(colorPct / 100 * 20));
        return (
          <Box sx={{ position: 'absolute', top: 1, left: 2, zIndex: 2, textAlign: 'left', lineHeight: 1, pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: nameSize, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {compactName(departureRes.firstName, departureRes.lastName)}
            </Typography>
            <Typography sx={{ fontSize: platSize, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {departureRes.platform}
            </Typography>
          </Box>
        );
      })()}
    </Box>
  );
}
