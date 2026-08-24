/**
 * CumulativeMonthCalendar — one calendar cumulating EVERY logement
 * (specs/cumulative-month-calendar.md). Each reservation (and each property closure) is a continuous
 * bar spanning its days, split per week row. Bars are **grouped by logement**: within a week the lanes
 * are organised per property (all of one logement's bars, then the next), colours from the platform;
 * closures are grey. Months are stacked vertically with **infinite scroll**; a sticky month label tells
 * you where you are. Render-only.
 *
 * Props:
 *   onReservationClick(id)        — open the reservation fiche.
 *   onCreateReservation(dateStr)  — empty-day click → new reservation prefilled with that date.
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Box, Typography, Button, Stack, Tooltip, CircularProgress, Chip, useMediaQuery, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import api from '../api';
import { getPlatformColor, formatPlatformLabel, mergePlatformVariants } from '../constants/platforms';
import { formatDate, shiftDate, getDaysInMonth } from '../utils/calendarVisuals';
import useInfiniteMonthScroll from '../hooks/useInfiniteMonthScroll';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const BAR_H = 22;      // px per lane
const HEADER_H = 24;   // px for the day-number band
// Closure bars/legend: theme grey (resolved via useTheme — bars are CSS strings, not sx tokens).
const closureColor = (theme) => theme.palette.grey[500];
const GLOBAL_GROUP_KEY = '';            // global closures (all logements) → sort first (top band)
const GLOBAL_LABEL = 'Tous les logements';

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

function mondayIndex(dateStr) {
  return (new Date(`${dateStr}T12:00:00`).getDay() + 6) % 7;
}

function resLabel(r) {
  return `${r.firstName || ''} ${r.lastName || ''}`.trim()
    || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim())
    || `Réservation #${r.id}`;
}

function monthGridRange(year, month) {
  const first = formatDate(year, month, 1);
  const from = shiftDate(first, -mondayIndex(first));
  return { from, to: shiftDate(from, 6 * 7 - 1) };
}

function frDay(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS_FR[(m || 1) - 1]}`;
}
export function frRange(start, end) {
  return start === end ? frDay(start) : `${frDay(start)} → ${frDay(end)}`;
}

/**
 * Normalise reservations + closures into a single item list for the calendar.
 * Each item: { key, kind:'reservation'|'closure', groupKey, propertyName, startDate, lastDay,
 *              platform?, label, reservationId? }. `lastDay` is the last OCCUPIED day (closures use a
 * half-open [startDate, endDate) interval → lastDay = endDate − 1). `groupKey` drives the per-logement
 * lane grouping ('' = global closures, sorted to the top band).
 * Exported for the unit test.
 */
export function normalizeItems(reservations, closures) {
  const items = [];
  for (const r of (Array.isArray(reservations) ? reservations : [])) {
    if (!r || !r.startDate || !r.endDate) continue;
    const propertyName = r.propertyName || '';
    items.push({
      key: `r${r.id}`, kind: 'reservation', reservationId: r.id,
      groupKey: propertyName || `#${r.propertyId}`, propertyName,
      startDate: r.startDate, lastDay: r.endDate,
      platform: r.platform,
      label: `${propertyName ? `${propertyName} · ` : ''}${resLabel(r)}`,
    });
  }
  for (const c of (Array.isArray(closures) ? closures : [])) {
    if (!c || !c.startDate || !c.endDate) continue;
    const lastDay = shiftDate(c.endDate, -1); // half-open → last occupied day
    if (lastDay < c.startDate) continue;
    const isGlobal = c.propertyId == null;
    const propertyName = isGlobal ? GLOBAL_LABEL : (c.propertyName || '');
    items.push({
      key: `c${c.id}`, kind: 'closure',
      groupKey: isGlobal ? GLOBAL_GROUP_KEY : (c.propertyName || `#${c.propertyId}`), propertyName,
      startDate: c.startDate, lastDay,
      label: c.label || 'Fermé',
    });
  }
  return items;
}

/**
 * Build the month grid + per-week spanning bars, lane-packed and GROUPED BY LOGEMENT.
 * Returns { weeks: [{ days:[{date,inMonth,isToday}], bars:[{item,startCol,endCol,lane,roundStart,roundEnd}], laneCount }] }.
 * Pure — exported for the unit test. `items` come from `normalizeItems`.
 */
export function buildMonthLayout(year, month, items, todayStr) {
  const firstOfMonth = formatDate(year, month, 1);
  const offset = mondayIndex(firstOfMonth);
  const gridStart = shiftDate(firstOfMonth, -offset);
  const daysInMonth = getDaysInMonth(year, month);
  const weekCount = Math.ceil((offset + daysInMonth) / 7);
  const list = Array.isArray(items) ? items.filter((it) => it && it.startDate && it.lastDay) : [];

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
      .filter((it) => it.lastDay >= weekStart && it.startDate <= weekEnd)
      .map((it) => {
        const segStart = it.startDate > weekStart ? it.startDate : weekStart;
        const segEnd = it.lastDay < weekEnd ? it.lastDay : weekEnd;
        const startCol = Math.max(0, Math.min(6, daysBetween(weekStart, segStart)));
        const endCol = Math.max(0, Math.min(6, daysBetween(weekStart, segEnd)));
        const roundStart = segStart === it.startDate;
        const roundEnd = segEnd === it.lastDay;
        // Bars start at the middle of their first day and end at the middle of their last day (only at
        // the TRUE start/end, not at a week-split edge) — for reservations (arrival/departure mid-day)
        // AND closures, for a consistent look. Fractional column edges (0..7).
        const leftEdge = startCol + (roundStart ? 0.5 : 0);
        const rightEdge = (endCol + 1) - (roundEnd ? 0.5 : 0);
        return { item: it, startCol, endCol, roundStart, roundEnd, leftEdge, rightEdge };
      });

    // Group by logement; each group gets a contiguous band of lanes (so a logement's bars stay
    // together, then the next logement below). Global closures ('') sort to the top.
    const groups = new Map();
    for (const seg of segments) {
      if (!groups.has(seg.item.groupKey)) groups.set(seg.item.groupKey, []);
      groups.get(seg.item.groupKey).push(seg);
    }
    const orderedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
    let laneBase = 0;
    for (const key of orderedKeys) {
      const segs = groups.get(key).sort((a, b) => (a.leftEdge - b.leftEdge)
        || (b.rightEdge - b.leftEdge) - (a.rightEdge - a.leftEdge)
        || String(a.item.key).localeCompare(String(b.item.key)));
      const laneEnds = []; // last right edge (fractional cols) per lane within this group
      for (const seg of segs) {
        // A same-day turnover (departure ends at X.5, arrival starts at X.5) shares the lane (<=).
        let local = laneEnds.findIndex((end) => end <= seg.leftEdge);
        if (local === -1) { local = laneEnds.length; laneEnds.push(seg.rightEdge); }
        else laneEnds[local] = seg.rightEdge;
        seg.lane = laneBase + local;
      }
      laneBase += laneEnds.length;
    }
    weeks.push({ days, bars: segments, laneCount: laneBase });
  }
  return { weeks };
}

// Items overlapping a month, ordered by arrival date (the mobile agenda list reads as a chronological
// timeline of check-ins). Logement + key only break ties between same-day arrivals for a stable order.
export function monthItems(year, month, items) {
  const mStart = formatDate(year, month, 1);
  const mEnd = formatDate(year, month, getDaysInMonth(year, month));
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.startDate && it.lastDay && it.startDate <= mEnd && it.lastDay >= mStart)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)
      || a.groupKey.localeCompare(b.groupKey, 'fr')
      || String(a.key).localeCompare(String(b.key)));
}

function MonthBlock({ year, month, items, todayStr, isMobile, onReservationClick, onCreateReservation }) {
  const theme = useTheme();
  const CLOSURE_COLOR = closureColor(theme);
  const { weeks } = useMemo(
    () => (isMobile ? { weeks: [] } : buildMonthLayout(year, month, items, todayStr)),
    [year, month, items, todayStr, isMobile],
  );
  const list = useMemo(() => (isMobile ? monthItems(year, month, items) : []), [year, month, items, isMobile]);

  const stickyLabel = (
    <Typography
      variant="sectionHeader"
      sx={{
        display: 'block', position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', py: 0.5,
        textTransform: 'capitalize', borderBottom: '2px solid', borderColor: 'primary.light',
      }}
    >
      {MONTHS_FR[month]} {year}
    </Typography>
  );

  // Mobile = a readable agenda list (one row per reservation / closure), grouped by logement.
  if (isMobile) {
    return (
      <Box data-month-anchor={`${year}-${month}`} sx={{ mb: 2 }}>
        {stickyLabel}
        {list.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>Aucune réservation.</Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {list.map((it) => {
            const closure = it.kind === 'closure';
            const color = closure ? CLOSURE_COLOR : getPlatformColor(it.platform);
            return (
              <Box
                key={it.key}
                onClick={() => !closure && onReservationClick && onReservationClick(it.reservationId)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
                  borderLeft: '5px solid', borderColor: color, bgcolor: 'background.paper', boxShadow: 1,
                  cursor: closure ? 'default' : 'pointer', minHeight: 48, '&:active': closure ? undefined : { bgcolor: 'action.selected' },
                  // Past stays are greyed (purely visual) — same language as the per-property calendar
                  // (CalendarDayCell). `lastDay` is the inclusive last occupied day; past once today is after it.
                  opacity: todayStr > it.lastDay ? 0.5 : 1,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {closure ? `Fermé — ${it.propertyName}` : (it.propertyName || 'Logement')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {closure ? it.label : it.label.replace(`${it.propertyName} · `, '')}
                  </Typography>
                </Box>
                <Stack spacing={0.25} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{frRange(it.startDate, it.lastDay)}</Typography>
                  {!closure && <Chip label={formatPlatformLabel(it.platform)} size="small" sx={{ height: 18, fontSize: 10, bgcolor: color, color: 'common.white' }} />}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>
    );
  }

  return (
    <Box data-month-anchor={`${year}-${month}`} sx={{ mb: 2 }}>
      {stickyLabel}
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
                    // Today is framed with a thicker primary border (specs/cumulative-month-calendar.md §6).
                    border: day.isToday ? '2px solid' : '1px solid',
                    borderColor: day.isToday ? 'primary.main' : 'divider',
                    borderRadius: 1,
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
              const { item } = bar;
              const closure = item.kind === 'closure';
              const color = closure ? CLOSURE_COLOR : getPlatformColor(item.platform);
              const left = `calc(${(bar.leftEdge / 7) * 100}% + 1px)`;
              const width = `calc(${((bar.rightEdge - bar.leftEdge) / 7) * 100}% - 2px)`;
              const top = HEADER_H + bar.lane * BAR_H;
              return (
                <Tooltip key={`${item.key}-${bar.startCol}`} title={`${item.label} (${frRange(item.startDate, item.lastDay)})`} arrow>
                  <Box
                    onClick={closure ? undefined : (e) => { e.stopPropagation(); onReservationClick && onReservationClick(item.reservationId); }}
                    sx={{
                      position: 'absolute', left, width, top, height: BAR_H - 4,
                      bgcolor: color, color: 'common.white', cursor: closure ? 'default' : 'pointer',
                      borderTopLeftRadius: bar.roundStart ? 6 : 0, borderBottomLeftRadius: bar.roundStart ? 6 : 0,
                      borderTopRightRadius: bar.roundEnd ? 6 : 0, borderBottomRightRadius: bar.roundEnd ? 6 : 0,
                      px: 0.5, display: 'flex', alignItems: 'center', overflow: 'hidden',
                      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      boxShadow: 1, ...(closure ? { border: (t) => `1px dashed ${alpha(t.palette.common.black, 0.25)}` } : { '&:hover': { filter: 'brightness(0.92)' } }),
                      // Past stays greyed (visual only), consistent with the mobile agenda + per-property grid.
                      opacity: todayStr > item.lastDay ? 0.5 : 1,
                    }}
                  >
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {closure ? `Fermé${item.propertyName ? ` — ${item.propertyName}` : ''}` : item.label}
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { months, scrollRef, handleScroll, focusOnMonth } = useInfiniteMonthScroll('all');
  const [reservationsById, setReservationsById] = useState({});
  const [closuresById, setClosuresById] = useState({});
  const [loading, setLoading] = useState(false);
  const loadedKeys = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const todayStr = useMemo(() => { const n = new Date(); return formatDate(n.getFullYear(), n.getMonth(), n.getDate()); }, []);

  // Incrementally load each newly-visible month's reservations + closures (all logements), merged by id.
  // The in-flight fetch is cancelled only on unmount (see #230 fix).
  useEffect(() => {
    const toLoad = months.filter((m) => !loadedKeys.current.has(`${m.year}-${m.month}`));
    if (toLoad.length === 0) return;
    toLoad.forEach((m) => loadedKeys.current.add(`${m.year}-${m.month}`));
    setLoading(true);
    Promise.all(toLoad.map((m) => {
      const { from, to } = monthGridRange(m.year, m.month);
      return Promise.all([
        api.getReservations({ from, to }).catch(() => []),
        api.getEstablishmentClosures({ from, to }).catch(() => []),
      ]);
    })).then((results) => {
      if (!mountedRef.current) return;
      setReservationsById((prev) => {
        const next = { ...prev };
        for (const [reservations] of results) for (const r of (reservations || [])) if (r && r.id != null) next[r.id] = r;
        return next;
      });
      setClosuresById((prev) => {
        const next = { ...prev };
        for (const [, closures] of results) for (const c of (closures || [])) if (c && c.id != null) next[c.id] = c;
        return next;
      });
    }).finally(() => { if (mountedRef.current) setLoading(false); });
  }, [months]);

  // Open on the current month.
  useEffect(() => {
    const n = new Date();
    focusOnMonth(n.getFullYear(), n.getMonth());
  }, [focusOnMonth]);

  const items = useMemo(
    () => normalizeItems(Object.values(reservationsById), Object.values(closuresById)),
    [reservationsById, closuresById],
  );

  // The mount focus above runs before the reservations finish loading. On mobile the month blocks are
  // variable-height agenda lists, so once the data lands the block heights change and the first scroll
  // ends up on a stale month. Re-focus the current month ONCE, after the first batch of items settles
  // the heights. (Desktop grids are fixed-height → effectively a no-op there.) An empty calendar keeps
  // uniform heights → no need.
  const didSettleFocusRef = useRef(false);
  useEffect(() => {
    if (didSettleFocusRef.current || items.length === 0) return;
    didSettleFocusRef.current = true;
    const n = new Date();
    focusOnMonth(n.getFullYear(), n.getMonth());
  }, [items, focusOnMonth]);

  const goToday = useCallback(() => { const n = new Date(); focusOnMonth(n.getFullYear(), n.getMonth(), { resetNavLocks: true }); }, [focusOnMonth]);

  // The legend lists each platform ONCE: variants that differ only by case or punctuation
  // ('Abracadaroom' / 'abracadaroom') are the same platform and merge into one canonical entry.
  const platformsInView = useMemo(
    () => mergePlatformVariants(Object.values(reservationsById).map((r) => r.platform)),
    [reservationsById],
  );
  const hasClosures = Object.keys(closuresById).length > 0;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button onClick={goToday} size="small" variant="outlined">Aujourd'hui</Button>
          <Typography variant="caption" color="text.secondary">Faites défiler pour changer de mois</Typography>
          {loading && <CircularProgress size={18} />}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {platformsInView.map(({ platform, label, color }) => (
            <Stack key={platform} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color }} />
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Stack>
          ))}
          {hasClosures && (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: 'grey.500' }} />
              <Typography variant="caption" color="text.secondary">Fermeture</Typography>
            </Stack>
          )}
        </Stack>
      </Stack>

      <Box ref={scrollRef} onScroll={handleScroll} sx={{ overflowY: 'auto', overflowX: { xs: 'visible', sm: 'auto' }, maxHeight: { xs: '74vh', sm: 'calc(100vh - 240px)' }, pr: 0.5 }}>
        <Box sx={{ minWidth: { xs: 'auto', sm: 720 } }}>
          {months.map((m) => (
            <MonthBlock
              key={`${m.year}-${m.month}`}
              year={m.year}
              month={m.month}
              items={items}
              todayStr={todayStr}
              isMobile={isMobile}
              onReservationClick={onReservationClick}
              onCreateReservation={onCreateReservation}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
