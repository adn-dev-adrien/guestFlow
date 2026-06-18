/**
 * CumulativeMonthCalendar — one calendar cumulating EVERY logement
 * (specs/cumulative-month-calendar.md). Each reservation is a continuous bar spanning its days,
 * split per week row, stacked in lanes, coloured by platform. Months are stacked vertically with
 * **infinite scroll** (no month buttons): scrolling up/down loads the previous/next month, and a
 * sticky month label tells you where you are. Render-only.
 *
 * Props:
 *   onReservationClick(id)        — open the reservation fiche.
 *   onCreateReservation(dateStr)  — empty-day click → new reservation prefilled with that date.
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Box, Typography, Button, Stack, Tooltip, CircularProgress } from '@mui/material';
import api from '../api';
import { getPlatformColor, formatPlatformLabel } from '../constants/platforms';
import { formatDate, shiftDate, getDaysInMonth } from '../utils/calendarVisuals';
import useInfiniteMonthScroll from '../hooks/useInfiniteMonthScroll';

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
  return `${r.firstName || ''} ${r.lastName || ''}`.trim()
    || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim())
    || `Réservation #${r.id}`;
}

// The grid range (Monday before the 1st → 6 weeks later) covering a month's calendar.
function monthGridRange(year, month) {
  const first = formatDate(year, month, 1);
  const from = shiftDate(first, -mondayIndex(first));
  return { from, to: shiftDate(from, 6 * 7 - 1) };
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

    const laneEnds = [];
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

function MonthBlock({ year, month, reservations, todayStr, onReservationClick, onCreateReservation }) {
  const { weeks } = useMemo(() => buildMonthLayout(year, month, reservations, todayStr), [year, month, reservations, todayStr]);
  return (
    <Box data-month-anchor={`${year}-${month}`} sx={{ mb: 2 }}>
      {/* Sticky month label so you always know where you are while scrolling. */}
      <Typography
        variant="subtitle1"
        sx={{
          position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', py: 0.5,
          fontWeight: 800, textTransform: 'capitalize', borderBottom: '2px solid', borderColor: 'primary.light',
        }}
      >
        {MONTHS_FR[month]} {year}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', my: 0.5 }}>
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>{d}</Typography>
        ))}
      </Box>
      {weeks.map((week, wi) => {
        const rowHeight = HEADER_H + Math.max(1, week.laneCount) * BAR_H + 6;
        return (
          <Box key={wi} sx={{ position: 'relative', height: rowHeight, mb: 0.5 }}>
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
                      {`${bar.res.propertyName ? `${bar.res.propertyName} · ` : ''}${resLabel(bar.res)}`}
                    </Box>
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

export default function CumulativeMonthCalendar({ onReservationClick, onCreateReservation }) {
  // Reuse the per-property infinite-scroll machinery; the sentinel keeps its scroll effects active
  // (the hook only gates on `selectedProp` truthiness, not its value).
  const { months, scrollRef, handleScroll, focusOnMonth } = useInfiniteMonthScroll('all');
  const [reservationsById, setReservationsById] = useState({});
  const [loading, setLoading] = useState(false);
  const loadedKeys = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const todayStr = useMemo(() => { const n = new Date(); return formatDate(n.getFullYear(), n.getMonth(), n.getDate()); }, []);

  // Incrementally load each newly-visible month's reservations (all logements), merged by id. The
  // in-flight fetch is NOT cancelled on a months change (only on unmount) — otherwise the focus-to-today
  // re-render would drop the first fetch while its key is already marked loaded, losing the data.
  useEffect(() => {
    const toLoad = months.filter((m) => !loadedKeys.current.has(`${m.year}-${m.month}`));
    if (toLoad.length === 0) return;
    toLoad.forEach((m) => loadedKeys.current.add(`${m.year}-${m.month}`));
    setLoading(true);
    Promise.all(toLoad.map((m) => {
      const { from, to } = monthGridRange(m.year, m.month);
      return api.getReservations({ from, to }).catch(() => []);
    })).then((results) => {
      if (!mountedRef.current) return;
      setReservationsById((prev) => {
        const next = { ...prev };
        for (const arr of results) for (const r of (arr || [])) if (r && r.id != null) next[r.id] = r;
        return next;
      });
    }).finally(() => { if (mountedRef.current) setLoading(false); });
  }, [months]);

  // Land on the current month on mount.
  useEffect(() => {
    const n = new Date();
    focusOnMonth(n.getFullYear(), n.getMonth());
  }, [focusOnMonth]);

  const reservations = useMemo(() => Object.values(reservationsById), [reservationsById]);
  const goToday = useCallback(() => { const n = new Date(); focusOnMonth(n.getFullYear(), n.getMonth(), { resetNavLocks: true }); }, [focusOnMonth]);

  const platformsInView = useMemo(() => {
    const set = new Map();
    for (const r of reservations) { if (r.platform && !set.has(r.platform)) set.set(r.platform, getPlatformColor(r.platform)); }
    return [...set.entries()];
  }, [reservations]);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button onClick={goToday} size="small" variant="outlined">Aujourd'hui</Button>
          <Typography variant="caption" color="text.secondary">Faites défiler pour changer de mois</Typography>
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

      {/* Bounded, scrollable container = the infinite-scroll surface. Horizontal scroll on mobile. */}
      <Box ref={scrollRef} onScroll={handleScroll} sx={{ overflowY: 'auto', overflowX: 'auto', maxHeight: { xs: '72vh', sm: 'calc(100vh - 240px)' }, pr: 0.5 }}>
        <Box sx={{ minWidth: 720 }}>
          {months.map((m) => (
            <MonthBlock
              key={`${m.year}-${m.month}`}
              year={m.year}
              month={m.month}
              reservations={reservations}
              todayStr={todayStr}
              onReservationClick={onReservationClick}
              onCreateReservation={onCreateReservation}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
