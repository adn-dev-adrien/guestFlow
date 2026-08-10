import React, { useMemo } from 'react';
import {
  Box, Button, IconButton, Typography, Card, CardContent, Stack
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { getPlatformColor } from '../constants/platforms';
import { getBlockedNightConflictInfo } from '../utils/reservationConflicts';
import { BLOCKED_NIGHT_COLOR } from '../utils/calendarVisuals';

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

// `buildMiniStripDayGradient` is a PURE exported function (pinned by calendar-platform-colors.test.js)
// so it cannot read the theme: EMPTY_DAY_COLOR stays a module constant (the grey[100] equivalent).
// BLOCKED_NIGHT_COLOR comes from the single-source calendar constants (ds-sweep-planning rule 14).
const EMPTY_DAY_COLOR = '#f5f5f5';

/**
 * Compute the day-cell background + text colour for the mini planning strip.
 * Pure function so the colour-resolution path is unit-testable in isolation
 * — the test ensures every UpperCamelCase platform value flows through
 * `getPlatformColor` and never falls back to grey.
 *
 * Exported for `__tests__/calendar-platform-colors.test.js`. Production code
 * uses it via the inline wrapper inside the component (which closes over the
 * currently-selected reservation colour).
 */
export function buildMiniStripDayGradient({
  departureRes,
  arrivalRes,
  middleRes,
  blockedNightInfo,
  departureIsSelected,
  arrivalIsSelected,
  middleIsSelected,
  selectedReservationColor,
}) {
  if (!departureRes && !arrivalRes && !middleRes) {
    return { background: EMPTY_DAY_COLOR, textColor: 'text.primary' };
  }

  if (middleRes && !departureRes && !arrivalRes) {
    const fullColor = middleIsSelected ? selectedReservationColor : getPlatformColor(middleRes.platform);
    return { background: fullColor, textColor: '#fff' };
  }

  const departPct = departureRes ? hourToPercent(timeToHour(departureRes.checkOutTime || '10:00')) : null;
  const arrivePct = arrivalRes ? hourToPercent(timeToHour(arrivalRes.checkInTime || '15:00')) : null;
  const departColor = departureRes
    ? (departureIsSelected ? selectedReservationColor : getPlatformColor(departureRes.platform))
    : null;
  const arriveColor = arrivalRes
    ? (arrivalIsSelected ? selectedReservationColor : getPlatformColor(arrivalRes.platform))
    : null;

  const stops = [];

  if (departPct !== null) {
    stops.push(`${departColor} 0%`);
    stops.push(`${departColor} ${departPct}%`);
    if (blockedNightInfo?.type === 'late-departure-evening') {
      const blockedEnd = arrivePct !== null ? Math.min(arrivePct, 100) : 100;
      stops.push(`${BLOCKED_NIGHT_COLOR} ${departPct}%`);
      stops.push(`${BLOCKED_NIGHT_COLOR} ${blockedEnd}%`);
      if (arrivePct !== null && arrivePct > blockedEnd) {
        stops.push(`${EMPTY_DAY_COLOR} ${blockedEnd}%`);
        stops.push(`${EMPTY_DAY_COLOR} ${arrivePct}%`);
      }
    } else if (arrivePct !== null && arrivePct > departPct) {
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
}

export default function MiniPlanningStrip({
  miniCalendarStart,
  setMiniCalendarStart = () => {},
  miniVisibleDays = 7,
  reservations = [],
  selectedPropertyId,
  currentReservation,
  currentReservationId,
  onDateClick = () => {},
  onRecenter = () => {},
  isLocked,
}) {
  const theme = useTheme();
  const safeReservations = Array.isArray(reservations) ? reservations : [];
  // Use getPlatformColor so the lookup tolerates UpperCamelCase (post-PR #118 normalisation),
  // lowercase, or accented free-form platform values — all resolve to the same colour.
  // No platform → brand primary (deliberately NOT the grey DEFAULT_PLATFORM_COLOR, see docstring).
  const selectedReservationColor = currentReservation?.platform
    ? getPlatformColor(currentReservation.platform)
    : theme.palette.primary.main;

  const miniDays = useMemo(() => {
    return Array.from({ length: miniVisibleDays }, (_, i) => addDays(miniCalendarStart, i)).filter(Boolean);
  }, [miniCalendarStart, miniVisibleDays]);

  const otherReservationsForMini = useMemo(() => {
    const scoped = safeReservations.filter((r) => Number(r.propertyId) === Number(selectedPropertyId));
    if (!currentReservationId) return scoped;
    return scoped.filter((r) => r.id !== currentReservationId);
  }, [safeReservations, selectedPropertyId, currentReservationId]);

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

  // Thin wrapper closing over `selectedReservationColor` so the JSX below stays
  // unchanged. The actual colour-resolution logic lives in
  // `buildMiniStripDayGradient` (exported above for testability).
  const buildDayGradient = (args) => buildMiniStripDayGradient({ ...args, selectedReservationColor });

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
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

        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1 }}>
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

          <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${miniDays.length || 1}, minmax(0, 1fr))`, gap: 1 }}>
            {miniDays.map((day) => {
            const isArrival = isArrivalDay(day);
            const isDeparture = isDepartureDay(day);
            const dateObj = parseDate(day);
            const weekLabel = ['D', 'L', 'M', 'M', 'J', 'V', 'S'][dateObj?.getDay() || 0];

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
            const blockedNightInfo = getBlockedNightConflictInfo(day, otherReservationsForMini);

            const mergedDeparture = selectedDeparture || otherDeparture;
            const mergedArrival = selectedArrival || otherArrival;
            const mergedMiddle = selectedMiddle || otherMiddle;

            const dayStyle = buildDayGradient({
              departureRes: mergedDeparture,
              arrivalRes: mergedArrival,
              middleRes: mergedMiddle,
                blockedNightInfo,
              departureIsSelected: Boolean(selectedDeparture),
              arrivalIsSelected: Boolean(selectedArrival),
              middleIsSelected: Boolean(selectedMiddle),
            });

            const hasReservationVisual = Boolean(mergedDeparture || mergedArrival || mergedMiddle);
              const finalDayStyle = !hasReservationVisual && blockedNightInfo?.type === 'early-arrival'
              ? { background: BLOCKED_NIGHT_COLOR, textColor: '#fff' }
              : dayStyle;

            const tooltipRes = selectedDeparture || selectedArrival || selectedMiddle || otherDeparture || otherArrival || otherMiddle;
            const blockedTooltip = blockedNightInfo
                ? blockedNightInfo.type === 'early-arrival'
                ? `Nuit bloquée: arrivée anticipée de ${blockedNightInfo.reservation?.firstName || ''} ${blockedNightInfo.reservation?.lastName || ''}`.trim()
                  : (blockedNightInfo.type === 'late-departure-evening'
                    ? `Nuit bloquée: départ tardif de ${blockedNightInfo.reservation?.firstName || ''} ${blockedNightInfo.reservation?.lastName || ''}`.trim()
                    : '')
              : '';

              return (
                <Box
                  key={day}
                  onClick={() => onDateClick(day)}
                  title={tooltipRes
                    ? `${tooltipRes.firstName || ''} ${tooltipRes.lastName || ''} (${tooltipRes.platform || 'reservation'})`
                    : (blockedTooltip || 'Disponible')}
                  sx={{
                    borderRadius: 1,
                    borderStyle: 'solid',
                    borderWidth: selectedDeparture || selectedArrival || selectedMiddle ? 3 : 1,
                    borderColor: selectedDeparture || selectedArrival || selectedMiddle
                      ? 'primary.main'
                      : (isArrival || isDeparture ? 'primary.main' : 'divider'),
                    background: finalDayStyle.background,
                    // Clip the fill to the padding box so the colored gradient never bleeds under
                    // the translucent divider border and shows through it as a colored rim — same
                    // fix as CalendarDayCell (#358). Without it the departure color reappears along
                    // the bottom/right edges and the arrival color along the top/left ones.
                    backgroundClip: 'padding-box',
                    minHeight: 56,
                    px: 0.5,
                    py: 1,
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
                      boxShadow: isLocked ? 'none' : 2,
                    },
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, color: finalDayStyle.textColor, lineHeight: 1.1, position: 'relative', zIndex: 1 }}>{weekLabel}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: finalDayStyle.textColor, lineHeight: 1.15, position: 'relative', zIndex: 1 }}>{dateObj?.getDate()}</Typography>
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
