import React, { useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const DAY_START = 8;
const DAY_END = 21;
const DAY_RANGE = DAY_END - DAY_START;
const EMPTY_DAY_COLOR = '#f5f5f5';
const HARD_STOP_EPSILON = 0.15;

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

function nudgeForward(value) {
  return Math.min(100, Math.max(0, value + HARD_STOP_EPSILON));
}

function nudgeBackward(value) {
  return Math.min(100, Math.max(0, value - HARD_STOP_EPSILON));
}

function buildDayGradient({ departureRes, arrivalRes, middleRes, platformColors }) {
  if (!departureRes && !arrivalRes && !middleRes) {
    return { background: EMPTY_DAY_COLOR, textColor: 'text.primary' };
  }

  if (middleRes && !departureRes && !arrivalRes) {
    const fullColor = platformColors[middleRes.platform] || '#757575';
    return { background: fullColor, textColor: '#fff' };
  }

  const departPct = departureRes ? hourToPercent(timeToHour(departureRes.checkOutTime || '10:00')) : null;
  const arrivePct = arrivalRes ? hourToPercent(timeToHour(arrivalRes.checkInTime || '15:00')) : null;
  const departColor = departureRes ? (platformColors[departureRes.platform] || '#757575') : null;
  const arriveColor = arrivalRes ? (platformColors[arrivalRes.platform] || '#757575') : null;

  const stops = [];

  if (departPct !== null) {
    stops.push(`${departColor} 0%`);
    stops.push(`${departColor} ${departPct}%`);
    if (arrivePct !== null && arrivePct > departPct) {
      stops.push(`${EMPTY_DAY_COLOR} ${nudgeForward(departPct)}%`);
      stops.push(`${EMPTY_DAY_COLOR} ${nudgeBackward(arrivePct)}%`);
    } else if (arrivePct === null) {
      stops.push(`${EMPTY_DAY_COLOR} ${nudgeForward(departPct)}%`);
      stops.push(`${EMPTY_DAY_COLOR} 100%`);
    }
  }

  if (arrivePct !== null) {
    if (departPct === null) {
      stops.push(`${EMPTY_DAY_COLOR} 0%`);
      stops.push(`${EMPTY_DAY_COLOR} ${nudgeBackward(arrivePct)}%`);
    }
    stops.push(`${arriveColor} ${arrivePct}%`);
    stops.push(`${arriveColor} 100%`);
  }

  const background = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : EMPTY_DAY_COLOR;
  const hasDeparturePartial = departPct !== null && departPct < 100;
  const hasArrivalPartial = arrivePct !== null && arrivePct > 0;
  return { background, textColor: hasDeparturePartial || hasArrivalPartial ? 'text.primary' : '#fff' };
}

function parseDateKey(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayDateKey() {
  const now = new Date();
  return formatDateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

function addDays(dateStr, count) {
  const date = parseDateKey(dateStr);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDateKey(date);
}

export default function SyncedPropertyMiniCalendars({
  properties,
  reservations,
  platformColors,
  onCreateReservation,
  onOpenProperty,
  initialStartDate,
  visibleDays = 14,
  title = 'Calendrier cumule',
  helperText = 'Cliquez une date de debut puis une date de fin sur un logement pour creer une reservation.',
  openPropertyLabel = 'Calendrier complet',
}) {
  const todayStr = getTodayDateKey();
  const [miniCalendarStart, setMiniCalendarStart] = useState(initialStartDate || todayStr);
  const [anchors, setAnchors] = useState({});

  const miniDays = useMemo(() => {
    return Array.from({ length: visibleDays }, (_, index) => addDays(miniCalendarStart, index));
  }, [miniCalendarStart, visibleDays]);

  const handleShift = (delta) => {
    setMiniCalendarStart((prev) => addDays(prev, delta));
  };

  const handleDayClick = (propertyId, day) => {
    const anchor = anchors[propertyId];
    if (!anchor || anchor === day) {
      setAnchors((prev) => ({ ...prev, [propertyId]: day }));
      return;
    }

    if (day < anchor) {
      setAnchors((prev) => ({ ...prev, [propertyId]: day }));
      return;
    }

    setAnchors((prev) => ({ ...prev, [propertyId]: '' }));
    onCreateReservation?.({ propertyId, startDate: anchor, endDate: day });
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1.5 }}>{title}</Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" color="text.secondary">
            {helperText}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" onClick={() => handleShift(-1)}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Button size="small" variant="outlined" onClick={() => setMiniCalendarStart(todayStr)}>
              Aujourd'hui
            </Button>
            <IconButton size="small" onClick={() => handleShift(1)}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {properties.map((property) => {
            const propertyReservations = reservations.filter((reservation) => Number(reservation.propertyId) === Number(property.id));
            return (
              <Box key={property.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{property.name}</Typography>
                  <Button size="small" onClick={() => onOpenProperty?.(property)}>{openPropertyLabel}</Button>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${miniDays.length}, minmax(42px, 1fr))`, gap: 0.5 }}>
                  {miniDays.map((day) => {
                    const date = parseDateKey(day);
                    const weekLabel = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][date.getUTCDay()];
                    const departureRes = propertyReservations.find((item) => item.endDate === day) || null;
                    const arrivalRes = propertyReservations.find((item) => item.startDate === day) || null;
                    const middleRes = propertyReservations.find((item) => day > item.startDate && day < item.endDate) || null;
                    const reservation = middleRes || arrivalRes || departureRes;
                    const isSelected = anchors[property.id] === day;
                    const dayStyle = buildDayGradient({
                      departureRes,
                      arrivalRes,
                      middleRes,
                      platformColors,
                    });
                    return (
                      <Box
                        key={`${property.id}-${day}`}
                        onClick={() => handleDayClick(property.id, day)}
                        title={reservation ? `${reservation.firstName} ${reservation.lastName} (${reservation.platform})` : 'Disponible'}
                        sx={{
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'rgba(0, 0, 0, 0.14)',
                          background: dayStyle.background,
                          backgroundClip: 'padding-box',
                          color: dayStyle.textColor,
                          minHeight: 56,
                          px: 0.25,
                          py: 0.5,
                          textAlign: 'center',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          position: 'relative',
                          transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                          boxShadow: isSelected ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.16)' : 'inset 0 0 0 1px rgba(255, 255, 255, 0.22)',
                          '&:hover': {
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.14)',
                          },
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, color: dayStyle.textColor, lineHeight: 1, position: 'relative', zIndex: 1 }}>{weekLabel}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: dayStyle.textColor, lineHeight: 1.1, position: 'relative', zIndex: 1 }}>{date.getUTCDate()}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}