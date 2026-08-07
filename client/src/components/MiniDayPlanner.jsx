import React, { useMemo, useRef } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';

const PIXELS_PER_MINUTE = 1.2;
const HOUR_COL_WIDTH = 40;

function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isTimeOccupied(slotStartMins, slotEndMins, occupiedSlots) {
  return occupiedSlots.some((occupied) => {
    const occupiedStart = timeToMinutes(occupied.startTime);
    const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
    return slotStartMins < occupiedEnd && slotEndMins > occupiedStart;
  });
}

export default function MiniDayPlanner({
  date,
  occupiedSlots = [],
  selectedStart,
  selectedEnd,
  onTimeSelect,
  openTime = '08:00',
  closeTime = '22:00',
  slotDuration = 5,
  minimumDuration = 5,
  disabled = false,
}) {
  const gridRef = useRef(null);
  const openMin = timeToMinutes(openTime);
  const closeMin = timeToMinutes(closeTime);
  const totalMin = Math.max(closeMin - openMin, 60);
  const gridHeight = totalMin * PIXELS_PER_MINUTE;

  const hourMarkers = useMemo(() => {
    const markers = [];
    const firstHour = Math.ceil(openMin / 60) * 60;
    for (let minutes = firstHour; minutes <= closeMin; minutes += 60) {
      markers.push({ minutes, top: (minutes - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin]);

  const slotMarkers = useMemo(() => {
    const markers = [];
    for (let minutes = openMin + slotDuration; minutes < closeMin; minutes += slotDuration) {
      if (minutes % 60 !== 0) markers.push({ top: (minutes - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin, slotDuration]);

  const occupiedBoxes = useMemo(() => {
    return occupiedSlots.map((occupied, index) => {
      const startMinutes = timeToMinutes(occupied.startTime);
      const endMinutes = timeToMinutes(occupied.endTime);
      const turnover = Number(occupied.turnover || 0);
      const top = (startMinutes - openMin) * PIXELS_PER_MINUTE;
      const height = Math.max((endMinutes - startMinutes) * PIXELS_PER_MINUTE, 6);
      const turnoverTop = top + height;
      const turnoverHeight = turnover * PIXELS_PER_MINUTE;
      return { ...occupied, key: index, top, height, turnoverTop, turnoverHeight };
    });
  }, [occupiedSlots, openMin]);

  const pendingBox = useMemo(() => {
    if (!selectedStart || selectedEnd) return null;
    const top = (timeToMinutes(selectedStart) - openMin) * PIXELS_PER_MINUTE;
    return { top };
  }, [selectedStart, selectedEnd, openMin]);

  const selectionBox = useMemo(() => {
    if (!selectedStart || !selectedEnd) return null;
    const startMinutes = timeToMinutes(selectedStart);
    const endMinutes = timeToMinutes(selectedEnd);
    const top = (startMinutes - openMin) * PIXELS_PER_MINUTE;
    const height = Math.max((endMinutes - startMinutes) * PIXELS_PER_MINUTE, 6);
    return { top, height };
  }, [selectedStart, selectedEnd, openMin]);

  function findHitOccupied(minutes) {
    return occupiedSlots.find((occupied) => {
      const occupiedStart = timeToMinutes(occupied.startTime);
      const occupiedEnd = timeToMinutes(occupied.endTime) + (occupied.turnover || 0);
      return minutes >= occupiedStart && minutes < occupiedEnd;
    });
  }

  function handleGridClick(event) {
    if (disabled || !gridRef.current) return;

    const rect = gridRef.current.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const rawMinutes = openMin + clickY / PIXELS_PER_MINUTE;
    const snapped = Math.round(rawMinutes / slotDuration) * slotDuration;
    const clamped = Math.max(openMin, Math.min(closeMin - slotDuration, snapped));
    const hitOccupied = findHitOccupied(clamped);
    const resourceTurnover = Number(occupiedSlots[0]?.turnover || 0);

    if (!selectedStart || selectedEnd) {
      if (hitOccupied) {
        const snapMinutes = timeToMinutes(hitOccupied.endTime) + (hitOccupied.turnover || 0);
        const startMinutes = Math.ceil(snapMinutes / slotDuration) * slotDuration;
        if (startMinutes + minimumDuration <= closeMin && !isTimeOccupied(startMinutes, startMinutes + minimumDuration, occupiedSlots)) {
          onTimeSelect(minutesToTime(startMinutes), 'start');
        }
        return;
      }

      if (clamped + minimumDuration <= closeMin && !isTimeOccupied(clamped, clamped + minimumDuration, occupiedSlots)) {
        onTimeSelect(minutesToTime(clamped), 'start');
      }
      return;
    }

    const selectedStartMinutes = timeToMinutes(selectedStart);
    const minimumEnd = selectedStartMinutes + minimumDuration;

    if (hitOccupied) {
      const snapMinutes = timeToMinutes(hitOccupied.startTime) - resourceTurnover;
      const endMinutes = Math.floor(snapMinutes / slotDuration) * slotDuration;
      if (endMinutes >= minimumEnd) {
        onTimeSelect(minutesToTime(endMinutes), 'end');
      } else {
        const afterMinutes = timeToMinutes(hitOccupied.endTime) + (hitOccupied.turnover || 0);
        const resetStart = Math.ceil(afterMinutes / slotDuration) * slotDuration;
        if (resetStart + minimumDuration <= closeMin && !isTimeOccupied(resetStart, resetStart + minimumDuration, occupiedSlots)) {
          onTimeSelect(minutesToTime(resetStart), 'start');
        }
      }
      return;
    }

    if (clamped < minimumEnd) {
      return;
    }

    if (isTimeOccupied(selectedStartMinutes, clamped, occupiedSlots)) {
      if (clamped + minimumDuration <= closeMin && !isTimeOccupied(clamped, clamped + minimumDuration, occupiedSlots)) {
        onTimeSelect(minutesToTime(clamped), 'start');
      }
      return;
    }

    onTimeSelect(minutesToTime(clamped), 'end');
  }

  function getDateDisplay() {
    if (!date) return '';
    try {
      const parsed = new Date(`${date}T12:00:00`);
      return parsed.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return date;
    }
  }

  const selectionState = !selectedStart
    ? 'Cliquez pour choisir l\'heure de début'
    : !selectedEnd
      ? `Début : ${selectedStart} — Cliquez pour l'heure de fin (min ${minimumDuration} min)`
      : `${selectedStart} → ${selectedEnd}`;

  return (
    <Box>
      {date && (
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1, color: 'text.secondary', textTransform: 'capitalize' }}>
          {getDateDisplay()}
        </Typography>
      )}

      <Box
        sx={{
          mb: 1,
          px: 1.5,
          py: 0.5,
          borderRadius: 1,
          // Selection-in-progress is INFO blue (not primary): the « complete » state is green, and the
          // « Maison » primary is green too — primary here would make the two states indistinguishable.
          bgcolor: (t) => (selectedStart && selectedEnd ? t.palette.success.soft : t.palette.info.soft),
          borderLeft: (t) => `3px solid ${selectedStart && selectedEnd ? t.palette.success.main : t.palette.info.main}`,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, color: selectedStart && selectedEnd ? 'success.dark' : 'info.dark' }}>
          {selectionState}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={(t) => ({ width: 10, height: 10, bgcolor: t.palette.error.soft, border: `1px solid ${alpha(t.palette.error.main, 0.4)}`, borderRadius: 0.5 })} />
          <Typography variant="caption" color="text.secondary">Occupé</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={(t) => ({ width: 10, height: 10, bgcolor: alpha(t.palette.error.main, 0.3), border: `1px dashed ${t.palette.error.dark}`, borderRadius: 0.5 })} />
          <Typography variant="caption" color="text.secondary">Remise en état</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: 'info.main', borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">Sélectionné</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
        <Box sx={{ width: HOUR_COL_WIDTH, flexShrink: 0, position: 'relative', height: gridHeight, bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}>
          {hourMarkers.map((marker) => (
            <Typography
              key={marker.minutes}
              variant="caption"
              sx={{
                position: 'absolute',
                top: marker.top - 7,
                right: 4,
                fontSize: '9px',
                color: 'text.secondary',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}
            >
              {minutesToTime(marker.minutes)}
            </Typography>
          ))}
        </Box>

        <Box
          ref={gridRef}
          onClick={handleGridClick}
          sx={{
            flex: 1,
            position: 'relative',
            height: gridHeight,
            bgcolor: 'background.default',
            cursor: disabled ? 'not-allowed' : 'crosshair',
            userSelect: 'none',
          }}
        >
          {slotMarkers.map((marker, index) => (
            <Box
              key={`slot-${index}`}
              sx={{
                position: 'absolute',
                top: marker.top,
                left: 0,
                right: 0,
                borderTop: '1px dashed',
                borderColor: 'divider',
                opacity: 0.35,
                pointerEvents: 'none',
              }}
            />
          ))}

          {hourMarkers.map((marker) => (
            <Box
              key={`hour-${marker.minutes}`}
              sx={{
                position: 'absolute',
                top: marker.top,
                left: 0,
                right: 0,
                borderTop: '1px solid',
                borderColor: 'divider',
                opacity: 0.6,
                pointerEvents: 'none',
              }}
            />
          ))}

          {occupiedBoxes.map((occupied) => (
            <Box key={occupied.key} sx={{ pointerEvents: 'none' }}>
              <Tooltip title={`${occupied.startTime}–${occupied.endTime} · ${occupied.description || 'Réservé'}`} arrow>
                <Box
                  sx={(t) => ({
                    position: 'absolute',
                    left: 2,
                    right: 2,
                    top: occupied.top,
                    height: occupied.height,
                    bgcolor: t.palette.error.soft,
                    border: `1px solid ${alpha(t.palette.error.main, 0.4)}`,
                    borderRadius: 0.5,
                    px: 0.5,
                    overflow: 'hidden',
                    pointerEvents: 'all',
                    zIndex: 2,
                  })}
                >
                  <Typography variant="caption" sx={{ fontSize: '9px', fontWeight: 700, color: 'error.dark', display: 'block', lineHeight: 1.3 }}>
                    {occupied.startTime}–{occupied.endTime}
                  </Typography>
                  {occupied.height >= 20 && (
                    <Typography variant="caption" sx={{ fontSize: '9px', color: 'error.dark', display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                      {occupied.description}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
              {occupied.turnoverHeight > 0 && (
                <Box
                  sx={(t) => ({
                    position: 'absolute',
                    left: 2,
                    right: 2,
                    top: occupied.turnoverTop,
                    height: Math.max(occupied.turnoverHeight, 4),
                    bgcolor: alpha(t.palette.error.main, 0.3),
                    border: `1px dashed ${alpha(t.palette.error.dark, 0.6)}`,
                    borderRadius: 0.5,
                    pointerEvents: 'none',
                    zIndex: 2,
                  })}
                />
              )}
            </Box>
          ))}

          {pendingBox && (
            <Box
              sx={{
                position: 'absolute',
                left: 2,
                right: 2,
                top: pendingBox.top - 1,
                height: 3,
                bgcolor: 'info.main',
                borderRadius: 1,
                pointerEvents: 'none',
                zIndex: 3,
                boxShadow: (t) => `0 0 0 2px ${alpha(t.palette.info.main, 0.3)}`,
              }}
            />
          )}

          {selectionBox && (
            <Box
              sx={{
                position: 'absolute',
                left: 2,
                right: 2,
                top: selectionBox.top,
                height: selectionBox.height,
                bgcolor: (t) => alpha(t.palette.info.main, 0.18),
                border: (t) => `2px solid ${t.palette.info.main}`,
                borderRadius: 0.75,
                pointerEvents: 'none',
                zIndex: 3,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                px: 0.5,
              }}
            >
              <Typography variant="caption" sx={{ fontSize: '9px', fontWeight: 700, color: 'info.dark', lineHeight: 1.3 }}>
                {selectedStart}–{selectedEnd}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}