import React, { useMemo } from 'react';
import {
  Box, Button, IconButton, Typography, Card, CardContent, Stack
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PLATFORM_COLORS } from '../constants/platforms';

const DAY_START = 8;
const DAY_END = 21;
const DAY_RANGE = DAY_END - DAY_START;

function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hourToPercent(hour) {
  return Math.max(0, Math.min(100, ((hour - DAY_START) / DAY_RANGE) * 100));
}

const EMPTY_DAY_COLOR = '#f5f5f5';

export default function MiniPlanningStrip({
  miniCalendarStart,
  setMiniCalendarStart,
  miniVisibleDays,
  reservations,
  selectedPropertyId,
  currentReservation,
  currentReservationId,
  onDateClick,
  onRecenter,
  isLocked,
}) {
  const selectedReservationColor = PLATFORM_COLORS[currentReservation?.platform] || '#1976d2';

  const miniDays = useMemo(() => {
    return Array.from({ length: miniVisibleDays }, (_, i) => addDays(miniCalendarStart, i)).filter(Boolean);
  }, [miniCalendarStart, miniVisibleDays]);

  const otherReservationsForMini = useMemo(() => {
    const scoped = reservations.filter((r) => Number(r.propertyId) === Number(selectedPropertyId));
    if (!currentReservationId) return scoped;
    return scoped.filter((r) => r.id !== currentReservationId);
  }, [reservations, selectedPropertyId, currentReservationId]);

  const findDepartureReservationOnDay = (dateStr) => {
    if (!dateStr) return null;
    return otherReservationsForMini.find((r) => r.endDate === dateStr) || null;
  };

  const findArrivalReservationOnDay = (dateStr) => {
    if (!dateStr) return null;
    return otherReservationsForMini.find((r) => r.startDate === dateStr) || null;
  };

  const findMiddleReservationOnDay = (dateStr) => {
    if (!dateStr) return null;
    return otherReservationsForMini.find((r) => dateStr > r.startDate && dateStr < r.endDate) || null;
  };

  const isArrivalDay = (dateStr) => {
    return currentReservation?.startDate === dateStr;
  };

  const isDepartureDay = (dateStr) => {
    return currentReservation?.endDate === dateStr;
  };

  const buildDayGradient = ({
    departureRes,
    arrivalRes,
    middleRes,
    departureIsSelected,
    arrivalIsSelected,
    middleIsSelected,
  }) => {
    if (!departureRes && !arrivalRes && !middleRes) {
      return { background: EMPTY_DAY_COLOR, textColor: 'text.primary' };
    }

    // Middle-of-stay day: fully filled.
    if (middleRes && !departureRes && !arrivalRes) {
      const fullColor = middleIsSelected ? selectedReservationColor : (PLATFORM_COLORS[middleRes.platform] || '#757575');
      return { background: fullColor, textColor: '#fff' };
    }

    const departPct = departureRes ? hourToPercent(timeToHour(departureRes.checkOutTime || '10:00')) : null;
    const arrivePct = arrivalRes ? hourToPercent(timeToHour(arrivalRes.checkInTime || '15:00')) : null;
    const departColor = departureRes
      ? (departureIsSelected ? selectedReservationColor : (PLATFORM_COLORS[departureRes.platform] || '#757575'))
      : null;
    const arriveColor = arrivalRes
      ? (arrivalIsSelected ? selectedReservationColor : (PLATFORM_COLORS[arrivalRes.platform] || '#757575'))
      : null;

    const stops = [];

    if (departPct !== null) {
      stops.push(`${departColor} 0%`);
      stops.push(`${departColor} ${departPct}%`);
      if (arrivePct !== null && arrivePct > departPct) {
        stops.push(`${EMPTY_DAY_COLOR} ${departPct}%`);
        stops.push(`${EMPTY_DAY_COLOR} ${arrivePct}%`);
      } else if (arrivePct === null) {
        stops.push(`${EMPTY_DAY_COLOR} ${departPct}%`);
        stops.push(`${EMPTY_DAY_COLOR} 100%`);
      }
    }

    if (arrivePct !== null) {
      if (departPct === null) {
        stops.push(`${EMPTY_DAY_COLOR} 0%`);
        stops.push(`${EMPTY_DAY_COLOR} ${arrivePct}%`);
      }
      stops.push(`${arriveColor} ${arrivePct}%`);
      stops.push(`${arriveColor} 100%`);
    }

    const background = stops.length > 0 ? `linear-gradient(135deg, ${stops.join(', ')})` : EMPTY_DAY_COLOR;
    const hasDeparturePartial = departPct !== null && departPct < 100;
    const hasArrivalPartial = arrivePct !== null && arrivePct > 0;
    const isPartialDay = hasDeparturePartial || hasArrivalPartial;
    return { background, textColor: isPartialDay ? 'text.primary' : '#fff' };
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: '#fff' }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          {miniDays.length > 0 && (() => {
            const firstDate = parseDate(miniDays[0]);
            const lastDate = parseDate(miniDays[miniDays.length - 1]);
            const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
            const firstMonth = monthNames[firstDate?.getMonth() || 0];
            const lastMonth = monthNames[lastDate?.getMonth() || 0];
            const firstYear = firstDate?.getFullYear();
            const lastYear = lastDate?.getFullYear();
            const monthDisplay = firstMonth === lastMonth && firstYear === lastYear
              ? `${firstMonth} ${firstYear}`
              : `${firstMonth} ${firstYear} - ${lastMonth} ${lastYear}`;
            return <Typography variant="caption" sx={{ fontWeight: 600 }}>{monthDisplay}</Typography>;
          })()}
          <Button size="small" variant="outlined" onClick={onRecenter} disabled={isLocked || !currentReservation?.startDate}>
            Recentrer
          </Button>
        </Stack>

        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.75 }}>
          <IconButton
            size="small"
            onClick={() => setMiniCalendarStart(addDays(miniCalendarStart, -1))}
            disabled={isLocked}
            sx={{
              width: 26,
              minWidth: 26,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              alignSelf: 'stretch',
              px: 0,
            }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>

          <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${miniDays.length || 1}, minmax(0, 1fr))`, gap: 0.75 }}>
            {miniDays.map((day) => {
            const isArrival = isArrivalDay(day);
            const isDeparture = isDepartureDay(day);
            const dateObj = parseDate(day);
            const weekLabel = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][dateObj?.getDay() || 0];

            const selectedDeparture = currentReservation?.endDate === day ? currentReservation : null;
            const selectedArrival = currentReservation?.startDate === day ? currentReservation : null;
            const selectedMiddle = currentReservation?.startDate && currentReservation?.endDate
              && day > currentReservation.startDate
              && day < currentReservation.endDate
              ? currentReservation
              : null;

            const otherDeparture = findDepartureReservationOnDay(day);
            const otherArrival = findArrivalReservationOnDay(day);
            const otherMiddle = findMiddleReservationOnDay(day);

            const mergedDeparture = selectedDeparture || otherDeparture;
            const mergedArrival = selectedArrival || otherArrival;
            const mergedMiddle = selectedMiddle || otherMiddle;

            const dayStyle = buildDayGradient({
              departureRes: mergedDeparture,
              arrivalRes: mergedArrival,
              middleRes: mergedMiddle,
              departureIsSelected: Boolean(selectedDeparture),
              arrivalIsSelected: Boolean(selectedArrival),
              middleIsSelected: Boolean(selectedMiddle),
            });

            const tooltipRes = selectedDeparture || selectedArrival || selectedMiddle || otherDeparture || otherArrival || otherMiddle;

              return (
                <Box
                  key={day}
                  onClick={() => onDateClick(day)}
                  title={tooltipRes ? `${tooltipRes.firstName || ''} ${tooltipRes.lastName || ''} (${tooltipRes.platform || 'reservation'})` : 'Disponible'}
                  sx={{
                    borderRadius: 1,
                    borderStyle: 'solid',
                    borderWidth: selectedDeparture || selectedArrival || selectedMiddle ? 3 : 1,
                    borderColor: selectedDeparture || selectedArrival || selectedMiddle
                      ? 'primary.main'
                      : (isArrival || isDeparture ? 'primary.main' : 'divider'),
                    background: dayStyle.background,
                    minHeight: 56,
                    px: 0.5,
                    py: 0.75,
                    textAlign: 'center',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    opacity: isLocked ? 0.85 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                    '&:hover': {
                      transform: isLocked ? 'none' : 'translateY(-1px)',
                      boxShadow: isLocked ? 'none' : '0 2px 6px rgba(0,0,0,0.14)',
                    },
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, color: dayStyle.textColor, lineHeight: 1.1, position: 'relative', zIndex: 1 }}>{weekLabel}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: dayStyle.textColor, lineHeight: 1.15, position: 'relative', zIndex: 1 }}>{dateObj?.getDate()}</Typography>
                </Box>
              );
            })}
          </Box>

          <IconButton
            size="small"
            onClick={() => setMiniCalendarStart(addDays(miniCalendarStart, 1))}
            disabled={isLocked}
            sx={{
              width: 26,
              minWidth: 26,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              alignSelf: 'stretch',
              px: 0,
            }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Cliquez une date d'arrivée puis une date de départ.
        </Typography>
      </CardContent>
    </Card>
  );
}
