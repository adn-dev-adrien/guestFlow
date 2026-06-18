/**
 * CumulativeMonthCalendar — one monthly calendar cumulating EVERY logement
 * (specs/cumulative-month-calendar.md). Each reservation is a continuous bar spanning its days,
 * split per week row, stacked in lanes, coloured by platform. Self-contained: own month state + nav,
 * fetches the displayed month's reservations (all logements). Render-only.
 *
 * Props:
 *   onReservationClick(id)        — open the reservation fiche.
 *   onCreateReservation(dateStr)  — empty-day click → new reservation prefilled with that date.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Typography, IconButton, Button, Stack, Tooltip, CircularProgress } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import api from '../api';
import { getPlatformColor, formatPlatformLabel } from '../constants/platforms';
import { formatDate, shiftDate, getDaysInMonth } from '../utils/calendarVisuals';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const BAR_H = 22;      // px per lane
const HEADER_H = 24;   // px for the day-number band

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

// Monday-first weekday index (0 = Monday … 6 = Sunday).
function mondayIndex(dateStr) {
  return (new Date(`${dateStr}T12:00:00`).getDay() + 6) % 7;
}

function resLabel(r) {
  const name = `${r.firstName || ''} ${r.lastName || ''}`.trim()
    || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim())
    || `Réservation #${r.id}`;
  return name;
}

/**
 * Build the month grid + per-week spanning bars with lane packing.
 * Returns { weeks: [{ days:[{date,inMonth,isToday}], bars:[{res,startCol,endCol,lane,roundStart,roundEnd}], laneCount }] }.
 * Pure — exported for the unit test.
 */
export function buildMonthLayout(year, month, reservations, todayStr) {
  const firstOfMonth = formatDate(year, month, 1);
  const offset = mondayIndex(firstOfMonth);
  const gridStart = shiftDate(firstOfMonth, -offset);
  const daysInMonth = getDaysInMonth(year, month);
  const weekCount = Math.ceil((offset + daysInMonth) / 7);
  const list = Array.isArray(reservations) ? reservations.filter((r) => r && r.startDate && r.endDate) : [];

  const weeks = [];
  for (let w = 0; w < weekCount; w += 1) {
    const weekStart = shiftDate(gridStart, w * 7);
    const weekEnd = shiftDate(weekStart, 6);
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const date = shiftDate(weekStart, i);
      days.push({
        date,
        inMonth: new Date(`${date}T12:00:00`).getMonth() === month,
        isToday: date === todayStr,
      });
    }

    // Segments overlapping this week, longest/earliest first for stable lane packing.
    const segments = list
      .filter((r) => r.endDate >= weekStart && r.startDate <= weekEnd)
      .map((r) => {
        const segStart = r.startDate > weekStart ? r.startDate : weekStart;
        const segEnd = r.endDate < weekEnd ? r.endDate : weekEnd;
        return {
          res: r,
          startCol: Math.max(0, Math.min(6, daysBetween(weekStart, segStart))),
          endCol: Math.max(0, Math.min(6, daysBetween(weekStart, segEnd))),
          roundStart: segStart === r.startDate,
          roundEnd: segEnd === r.endDate,
        };
      })
      .sort((a, b) => (a.res.startDate.localeCompare(b.res.startDate))
        || (b.endCol - b.startCol) - (a.endCol - a.startCol)
        || Number(a.res.id) - Number(b.res.id));

    const laneEnds = []; // last endCol occupied per lane
    for (const seg of segments) {
      let lane = laneEnds.findIndex((end) => end < seg.startCol);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.endCol); }
      else laneEnds[lane] = seg.endCol;
      seg.lane = lane;
    }
    weeks.push({ days, bars: segments, laneCount: laneEnds.length });
  }
  return { weeks };
}

export default function CumulativeMonthCalendar({ onReservationClick, onCreateReservation }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const todayStr = useMemo(() => formatDate(now.getFullYear(), now.getMonth(), now.getDate()), [now]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const firstOfMonth = formatDate(year, month, 1);
      const from = shiftDate(firstOfMonth, -mondayIndex(firstOfMonth));
      const to = shiftDate(from, 6 * 7); // 6 weeks horizon covers any month grid
      const data = await api.getReservations({ from, to });
      setReservations(Array.isArray(data) ? data : []);
    } catch {
      setReservations([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => { const m = month - 1; if (m < 0) { setMonth(11); setYear((y) => y - 1); } else setMonth(m); };
  const nextMonth = () => { const m = month + 1; if (m > 11) { setMonth(0); setYear((y) => y + 1); } else setMonth(m); };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()); };

  const { weeks } = useMemo(() => buildMonthLayout(year, month, reservations, todayStr), [year, month, reservations, todayStr]);

  const platformsInView = useMemo(() => {
    const set = new Map();
    for (const r of reservations) { if (r.platform && !set.has(r.platform)) set.set(r.platform, getPlatformColor(r.platform)); }
    return [...set.entries()];
  }, [reservations]);

  return (
    <Box>
      {/* Header: month nav + today + legend */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <IconButton onClick={prevMonth} aria-label="Mois précédent" sx={{ minWidth: 44, minHeight: 44 }}><ChevronLeftIcon /></IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700, textTransform: 'capitalize', minWidth: 160, textAlign: 'center' }}>
            {MONTHS_FR[month]} {year}
          </Typography>
          <IconButton onClick={nextMonth} aria-label="Mois suivant" sx={{ minWidth: 44, minHeight: 44 }}><ChevronRightIcon /></IconButton>
          <Button onClick={goToday} size="small" variant="outlined">Aujourd'hui</Button>
          {loading && <CircularProgress size={18} />}
        </Stack>
        {platformsInView.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {platformsInView.map(([platform, color]) => (
              <Stack key={platform} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color }} />
                <Typography variant="caption" color="text.secondary">{formatPlatformLabel(platform)}</Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>

      {/* Horizontal scroll on small screens keeps the 7 columns legible. */}
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 720 }}>
          {/* Weekday header */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}>
            {WEEKDAYS.map((d) => (
              <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>{d}</Typography>
            ))}
          </Box>

          {weeks.map((week, wi) => {
            const rowHeight = HEADER_H + Math.max(1, week.laneCount) * BAR_H + 6;
            return (
              <Box key={wi} sx={{ position: 'relative', height: rowHeight, mb: 0.5 }}>
                {/* Day cells (background) */}
                <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                  {week.days.map((day) => (
                    <Box
                      key={day.date}
                      onClick={() => onCreateReservation && onCreateReservation(day.date)}
                      sx={{
                        border: '1px solid', borderColor: 'divider', borderRadius: 1,
                        bgcolor: day.inMonth ? 'background.paper' : 'action.hover',
                        cursor: onCreateReservation ? 'pointer' : 'default',
                        '&:hover': onCreateReservation ? { bgcolor: 'action.selected' } : undefined,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block', textAlign: 'right', pr: 0.5, pt: 0.25, lineHeight: 1.4,
                          fontWeight: day.isToday ? 800 : 500,
                          color: day.isToday ? 'primary.main' : (day.inMonth ? 'text.primary' : 'text.disabled'),
                        }}
                      >
                        {Number(day.date.slice(8, 10))}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                {/* Reservation bars */}
                {week.bars.map((bar) => {
                  const color = getPlatformColor(bar.res.platform);
                  const left = `calc(${(bar.startCol / 7) * 100}% + 2px)`;
                  const width = `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - 4px)`;
                  const top = HEADER_H + bar.lane * BAR_H;
                  return (
                    <Tooltip key={`${bar.res.id}-${bar.startCol}`} title={`${bar.res.propertyName || ''} · ${resLabel(bar.res)} (${bar.res.startDate} → ${bar.res.endDate})`} arrow>
                      <Box
                        onClick={(e) => { e.stopPropagation(); onReservationClick && onReservationClick(bar.res.id); }}
                        sx={{
                          position: 'absolute', left, width, top, height: BAR_H - 4,
                          bgcolor: color, color: '#fff', cursor: 'pointer',
                          borderTopLeftRadius: bar.roundStart ? 6 : 0, borderBottomLeftRadius: bar.roundStart ? 6 : 0,
                          borderTopRightRadius: bar.roundEnd ? 6 : 0, borderBottomRightRadius: bar.roundEnd ? 6 : 0,
                          px: 0.75, display: 'flex', alignItems: 'center', overflow: 'hidden',
                          fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          boxShadow: 1, '&:hover': { filter: 'brightness(0.92)' },
                        }}
                      >
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {bar.res.propertyName ? `${bar.res.propertyName} · ` : ''}{resLabel(bar.res)}
                        </Box>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
