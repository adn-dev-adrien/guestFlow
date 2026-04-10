import React, { useMemo, useRef } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';

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

// Is the slot [slotStart, slotEnd) occupied (considering turnover)?
function isTimeOccupied(slotStartMins, slotEndMins, occupiedSlots) {
  return occupiedSlots.some(o => {
    const oStart = timeToMinutes(o.startTime);
    const oEnd = timeToMinutes(o.endTime) + (o.turnover || 0);
    return slotStartMins < oEnd && slotEndMins > oStart;
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
  disabled = false,
}) {
  const gridRef = useRef(null);
  const openMin = timeToMinutes(openTime);
  const closeMin = timeToMinutes(closeTime);
  const totalMin = Math.max(closeMin - openMin, 60);
  const gridHeight = totalMin * PIXELS_PER_MINUTE;

  // Hour markers
  const hourMarkers = useMemo(() => {
    const markers = [];
    const first = Math.ceil(openMin / 60) * 60;
    for (let m = first; m <= closeMin; m += 60) {
      markers.push({ minutes: m, top: (m - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin]);

  // Slot markers (light dashes every slotDuration minutes)
  const slotMarkers = useMemo(() => {
    const markers = [];
    for (let m = openMin + slotDuration; m < closeMin; m += slotDuration) {
      if (m % 60 !== 0) markers.push({ top: (m - openMin) * PIXELS_PER_MINUTE });
    }
    return markers;
  }, [openMin, closeMin, slotDuration]);

  // Existing bookings boxes
  const occupiedBoxes = useMemo(() => {
    return occupiedSlots.map((o, i) => {
      const startMins = timeToMinutes(o.startTime);
      const endMins = timeToMinutes(o.endTime);
      const turnover = o.turnover || 0;
      const top = (startMins - openMin) * PIXELS_PER_MINUTE;
      const height = Math.max((endMins - startMins) * PIXELS_PER_MINUTE, 6);
      const turnoverTop = top + height;
      const turnoverHeight = turnover * PIXELS_PER_MINUTE;
      return { ...o, top, height, turnoverTop, turnoverHeight, key: i };
    });
  }, [occupiedSlots, openMin]);

  // Selected range box
  const selectionBox = useMemo(() => {
    if (!selectedStart || !selectedEnd) return null;
    const startMins = timeToMinutes(selectedStart);
    const endMins = timeToMinutes(selectedEnd);
    const top = (startMins - openMin) * PIXELS_PER_MINUTE;
    const height = Math.max((endMins - startMins) * PIXELS_PER_MINUTE, 6);
    return { top, height };
  }, [selectedStart, selectedEnd, openMin]);

  // Pending start (1st click done, waiting for end)
  const pendingBox = useMemo(() => {
    if (!selectedStart || selectedEnd) return null;
    const startMins = timeToMinutes(selectedStart);
    const top = (startMins - openMin) * PIXELS_PER_MINUTE;
    return { top };
  }, [selectedStart, selectedEnd, openMin]);

  function handleGridClick(e) {
    if (disabled) return;
    const rect = gridRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const rawMins = openMin + clickY / PIXELS_PER_MINUTE;
    const snapped = Math.round(rawMins / slotDuration) * slotDuration;
    const clamped = Math.max(openMin, Math.min(closeMin - slotDuration, snapped));

    // Find if click lands inside an occupied slot (booking body + turnover window)
    const hitOccupied = occupiedSlots.find(o => {
      const oStart = timeToMinutes(o.startTime);
      const oEnd = timeToMinutes(o.endTime) + (o.turnover || 0);
      return clamped >= oStart && clamped < oEnd;
    });

    const resourceTurnover = occupiedSlots.length > 0 ? (occupiedSlots[0].turnover || 0) : 0;

    if (!selectedStart || (selectedStart && selectedEnd)) {
      // Setting START time
      if (hitOccupied) {
        // Snap to just after the end of this occupied slot (including its turnover)
        const snapMins = timeToMinutes(hitOccupied.endTime) + (hitOccupied.turnover || 0);
        const snappedToGrid = Math.ceil(snapMins / slotDuration) * slotDuration;
        if (snappedToGrid < closeMin) {
          onTimeSelect(minutesToTime(snappedToGrid), 'start');
        }
      } else {
        onTimeSelect(minutesToTime(clamped), 'start');
      }
    } else {
      // Setting END time (selectedStart is set, selectedEnd is not)
      if (hitOccupied) {
        // Snap end to just before this occupied slot begins, minus resource turnover
        const snapMins = timeToMinutes(hitOccupied.startTime) - resourceTurnover;
        const snappedToGrid = Math.floor(snapMins / slotDuration) * slotDuration;
        if (snappedToGrid > timeToMinutes(selectedStart)) {
          onTimeSelect(minutesToTime(snappedToGrid), 'end');
        } else {
          // No room — reset start to after this occupied slot
          const afterMins = timeToMinutes(hitOccupied.endTime) + (hitOccupied.turnover || 0);
          const afterGrid = Math.ceil(afterMins / slotDuration) * slotDuration;
          if (afterGrid < closeMin) onTimeSelect(minutesToTime(afterGrid), 'start');
        }
      } else if (clamped > timeToMinutes(selectedStart)) {
        // Check entire range is free
        const rangeOccupied = isTimeOccupied(timeToMinutes(selectedStart), clamped, occupiedSlots);
        if (rangeOccupied) {
          onTimeSelect(minutesToTime(clamped), 'start');
        } else {
          onTimeSelect(minutesToTime(clamped), 'end');
        }
      } else {
        // Clicked before or at start → reset start
        onTimeSelect(minutesToTime(clamped), 'start');
      }
    }
  }

  const getDateDisplay = () => {
    if (!date) return '';
    try {
      const d = new Date(`${date}T12:00:00`);
      return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch { return date; }
  };

  const selectionState = !selectedStart
    ? 'Cliquez pour choisir l\'heure de début'
    : !selectedEnd
    ? `Début : ${selectedStart} — Cliquez pour l'heure de fin`
    : `${selectedStart} → ${selectedEnd}`;

  return (
    <Box>
      {date && (
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.75, color: 'text.secondary', textTransform: 'capitalize' }}>
          {getDateDisplay()}
        </Typography>
      )}

      {/* Instruction bar */}
      <Box sx={{
        mb: 1, px: 1.5, py: 0.5, borderRadius: 1,
        bgcolor: selectedStart && selectedEnd ? '#e8f5e9' : '#e3f2fd',
        borderLeft: `3px solid ${selectedStart && selectedEnd ? '#4caf50' : '#1976d2'}`,
      }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: selectedStart && selectedEnd ? 'success.dark' : 'primary.dark' }}>
          {selectionState}
        </Typography>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, mb: 0.75, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: '#ffcdd2', border: '1px solid #ef9a9a', borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">Occupé</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: 'rgba(211,47,47,0.3)', border: '1px dashed #b71c1c', borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">Remise en état</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: '#1976d2', borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">Sélectionné</Typography>
        </Box>
      </Box>

      {/* Day grid */}
      <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }}>
        {/* Hour labels */}
        <Box sx={{ width: HOUR_COL_WIDTH, flexShrink: 0, position: 'relative', height: gridHeight, bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}>
          {hourMarkers.map((hm) => (
            <Typography
              key={hm.minutes}
              variant="caption"
              sx={{
                position: 'absolute',
                top: hm.top - 7,
                right: 4,
                fontSize: '9px',
                color: 'text.secondary',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}
            >
              {minutesToTime(hm.minutes)}
            </Typography>
          ))}
        </Box>

        {/* Grid area */}
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
          {/* Slot dashes */}
          {slotMarkers.map((sm, i) => (
            <Box key={i} sx={{
              position: 'absolute', top: sm.top, left: 0, right: 0,
              borderTop: '1px dashed', borderColor: 'divider', opacity: 0.35, pointerEvents: 'none',
            }} />
          ))}

          {/* Hour lines */}
          {hourMarkers.map((hm) => (
            <Box key={hm.minutes} sx={{
              position: 'absolute', top: hm.top, left: 0, right: 0,
              borderTop: '1px solid', borderColor: 'divider', opacity: 0.6, pointerEvents: 'none',
            }} />
          ))}

          {/* Occupied bookings */}
          {occupiedBoxes.map((ob) => (
            <Box key={ob.key} sx={{ pointerEvents: 'none' }}>
              <Tooltip title={`${ob.startTime}–${ob.endTime} · ${ob.description || 'Réservé'}`} arrow>
                <Box sx={{
                  position: 'absolute',
                  left: 2, right: 2,
                  top: ob.top,
                  height: ob.height,
                  bgcolor: '#ffcdd2',
                  border: '1px solid #ef9a9a',
                  borderRadius: 0.5,
                  px: 0.5,
                  overflow: 'hidden',
                  pointerEvents: 'all',
                  zIndex: 2,
                }}>
                  <Typography variant="caption" sx={{ fontSize: '9px', fontWeight: 700, color: '#c62828', display: 'block', lineHeight: 1.3 }}>
                    {ob.startTime}–{ob.endTime}
                  </Typography>
                  {ob.height >= 20 && (
                    <Typography variant="caption" sx={{ fontSize: '9px', color: '#c62828', display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                      {ob.description}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
              {ob.turnoverHeight > 0 && (
                <Box sx={{
                  position: 'absolute', left: 2, right: 2,
                  top: ob.turnoverTop, height: Math.max(ob.turnoverHeight, 4),
                  bgcolor: 'rgba(211,47,47,0.3)',
                  border: '1px dashed rgba(183,28,28,0.6)',
                  borderRadius: 0.5,
                  pointerEvents: 'none',
                  zIndex: 2,
                }} />
              )}
            </Box>
          ))}

          {/* Pending start marker (waiting for end click) */}
          {pendingBox && (
            <Box sx={{
              position: 'absolute', left: 2, right: 2,
              top: pendingBox.top - 1, height: 3,
              bgcolor: '#1976d2',
              borderRadius: 1,
              pointerEvents: 'none',
              zIndex: 3,
              boxShadow: '0 0 0 2px rgba(25,118,210,0.3)',
            }} />
          )}

          {/* Selected range */}
          {selectionBox && (
            <Box sx={{
              position: 'absolute', left: 2, right: 2,
              top: selectionBox.top, height: selectionBox.height,
              bgcolor: 'rgba(25,118,210,0.18)',
              border: '2px solid #1976d2',
              borderRadius: 0.75,
              pointerEvents: 'none',
              zIndex: 3,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              px: 0.5,
            }}>
              <Typography variant="caption" sx={{ fontSize: '9px', fontWeight: 700, color: '#1565c0', lineHeight: 1.3 }}>
                {selectedStart}–{selectedEnd}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
