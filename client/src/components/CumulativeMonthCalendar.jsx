/**
 * CumulativeMonthCalendar — one calendar cumulating EVERY logement
 * (specs/cumulative-month-calendar.md, amended by specs/calendar-property-parity.md). Each stay is a solid
 * bar in its platform colour spanning its days, split per week row; a stay that is over fades to a soft
 * tint with a stripe of that colour. Bars are **grouped by logement**: within a week the lanes are
 * organised per property, and a closure of one logement is a hatched bar in its logement's lane group
 * with the same half-day edges as a stay. A closure of every logement hatches whole day columns.
 * Months are stacked in an `InfiniteMonthScroller`, loaded once each from `GET /api/calendar`.
 * Render-only: the set of stays, their labels, colours and past flag come from the server.
 *
 * Props:
 *   onReservationClick(id)        — open the reservation fiche.
 *   onCreateReservation(dateStr)  — empty-day click → new reservation prefilled with that date.
 *   initialMonth? / onVisibleMonthChange? — forwarded to the scroller.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Box, Typography, Button, Stack, Tooltip, Chip, Collapse, useMediaQuery, useTheme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { alpha } from '@mui/material/styles';
import api from '../api';
import InfiniteMonthScroller from './InfiniteMonthScroller';
import useMonthDataCache from '../hooks/useMonthDataCache';
import { formatPlatformLabel, normalizePlatformKey } from '../constants/platforms';
import { barTint, closureHatch } from '../utils/calendarVisuals';
import { buildMonthLayout, monthGridRange, monthItems, normalizeItems, closedRange, closureLabel, frRange } from '../utils/calendarLayout';
import useServerToday from '../hooks/useServerToday';
import { localIsoToday } from '../utils/isoDay';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const BAR_H = 22;      // px per lane
const BAR_VISIBLE_H = 18;
const HEADER_H = 24;   // px for the day-number band
// Seven ~80 px days: the 720 it used to be hid Sunday behind a scroller next to the drawer at 900
// (2026-10-27 audit). Exported for the test that pins it under the md content width.
export const CALENDAR_MIN_WIDTH = 560;
function stayBarSx(item) {
  return item.past
    ? { bgcolor: barTint(item.color), color: 'text.primary', boxShadow: `inset 3px 0 0 ${item.color}`, '&:hover': { bgcolor: alpha(item.color, 0.24) } }
    : { bgcolor: item.color, color: item.textColor, '&:hover': { filter: 'brightness(0.92)' } };
}

function closureBarLabel(item) {
  return `${closureLabel(item)} — ${item.label}, ${closedRange(item)}`;
}

function MonthBlock({ year, month, data, todayStr, isMobile, onReservationClick, onCreateReservation }) {
  const theme = useTheme();
  const hatch = closureHatch(theme);
  const items = useMemo(() => normalizeItems(data && data.stays, data && data.closures), [data]);
  const { weeks } = useMemo(
    () => (isMobile ? { weeks: [] } : buildMonthLayout(year, month, items, todayStr)),
    [year, month, items, todayStr, isMobile],
  );
  const list = useMemo(() => (isMobile ? monthItems(year, month, items) : []), [year, month, items, isMobile]);

  // Phone = a readable agenda list (one row per stay / closure), grouped by logement.
  if (isMobile) {
    return (
      <Box>
        {data && list.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>Aucune réservation.</Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {list.map((it) => {
            const closure = it.kind === 'closure';
            return (
              <Box
                key={it.key}
                onClick={() => !closure && onReservationClick && onReservationClick(it.reservationId)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1,
                  ...(closure
                    ? { bgcolor: 'background.paper', backgroundImage: hatch, border: '1px solid', borderColor: 'divider' }
                    : { borderLeft: '5px solid', borderColor: it.color, bgcolor: 'background.paper', boxShadow: 1 }),
                  cursor: closure ? 'default' : 'pointer', minHeight: 48, '&:active': closure ? undefined : { bgcolor: 'action.selected' },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {closure ? closureLabel(it) : (it.propertyName || 'Logement')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {closure ? it.label : it.guestLabel}
                  </Typography>
                </Box>
                <Stack spacing={0.25} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {closure ? closedRange(it) : frRange(it.startDate, it.endDate)}
                  </Typography>
                  {!closure && (
                    <Chip
                      label={it.platformDisplay || formatPlatformLabel(it.platform)}
                      size="small"
                      sx={{ height: 20, fontSize: 11, fontWeight: 600, ...(it.past
                        ? { bgcolor: barTint(it.color), color: 'text.primary', boxShadow: `inset 3px 0 0 ${it.color}` }
                        : { bgcolor: it.color, color: it.textColor }) }}
                    />
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', my: 0.5 }}>
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>{d}</Typography>
        ))}
      </Box>
      {weeks.map((week, wi) => {
        // A week closed everywhere keeps one line for its label under the stays.
        const globalLabelH = week.globalClosures.length > 0 ? 16 : 0;
        const rowHeight = HEADER_H + Math.max(1, week.laneCount) * BAR_H + globalLabelH + 6;
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
                    position: 'relative',
                    overflow: 'hidden',
                    bgcolor: day.inMonth ? 'background.paper' : 'action.hover',
                    // A closure of every logement hatches the whole day.
                    ...(day.closedAll ? { backgroundImage: hatch } : {}),
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
            {/* The label of a closure of every logement, once per week, under the stays. */}
            {week.globalClosures.map((c) => (
              <Tooltip key={`${c.item.key}-label`} title={`${c.item.label} (${closedRange(c.item)})`} arrow>
                <Typography
                  component="span"
                  tabIndex={0}
                  aria-label={closureBarLabel(c.item)}
                  sx={{
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1, borderRadius: 0.5 },
                    position: 'absolute',
                    left: `calc(${(c.startCol / 7) * 100}% + 6px)`,
                    maxWidth: `calc(${((c.endCol - c.startCol + 1) / 7) * 100}% - 10px)`,
                    bottom: 3, zIndex: 1,
                    fontSize: 11, fontWeight: 600, lineHeight: '14px', color: 'text.secondary',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {closureLabel(c.item)}
                </Typography>
              </Tooltip>
            ))}
            {week.bars.map((bar) => {
              const { item } = bar;
              const closure = item.kind === 'closure';
              const left = `calc(${(bar.leftEdge / 7) * 100}% + 1px)`;
              const width = `calc(${((bar.rightEdge - bar.leftEdge) / 7) * 100}% - 2px)`;
              const top = HEADER_H + bar.lane * BAR_H;
              const radius = {
                borderTopLeftRadius: bar.roundStart ? 6 : 0, borderBottomLeftRadius: bar.roundStart ? 6 : 0,
                borderTopRightRadius: bar.roundEnd ? 6 : 0, borderBottomRightRadius: bar.roundEnd ? 6 : 0,
              };
              return (
                <Tooltip
                  key={`${item.key}-${bar.startCol}`}
                  title={closure ? `${closureBarLabel(item)}` : `${item.label} (${frRange(item.startDate, item.endDate)})`}
                  arrow
                >
                  <Box
                    {...(closure
                      ? { 'data-closure-bar': item.key, tabIndex: 0, role: 'img', 'aria-label': closureBarLabel(item) }
                      : { 'data-bar': item.key, onClick: (e) => { e.stopPropagation(); onReservationClick && onReservationClick(item.reservationId); } })}
                    sx={{
                      position: 'absolute', left, width, top, height: BAR_VISIBLE_H,
                      ...radius,
                      pl: 1, pr: 0.5, display: 'flex', alignItems: 'center', overflow: 'hidden',
                      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      ...(closure
                        ? {
                          bgcolor: 'background.paper', backgroundImage: hatch, color: 'text.primary', cursor: 'default',
                          border: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.25),
                          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
                        }
                        : { cursor: 'pointer', transition: 'filter 120ms ease-out, background-color 120ms ease-out', ...stayBarSx(item) }),
                    }}
                  >
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {closure ? `Fermé · ${item.label}` : item.label}
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

export default function CumulativeMonthCalendar({ onReservationClick, onCreateReservation, initialMonth, onVisibleMonthChange }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const serverToday = useServerToday();
  const todayStr = serverToday || localIsoToday();

  const loadMonth = useCallback(
    (year, month, signal) => api.getCalendar({ ...monthGridRange(year, month), signal }),
    [],
  );
  const cache = useMonthDataCache('all', loadMonth);

  // The legend lists each platform ONCE, named as the server names it, in the colour the bars carry.
  const { platformsInView, hasClosures } = useMemo(() => {
    const bySlug = new Map();
    let closures = false;
    Object.values(cache.entries).forEach((entry) => {
      if (!entry.data) return;
      if (entry.data.closures.length > 0) closures = true;
      entry.data.stays.forEach((s) => {
        const slug = normalizePlatformKey(s.platform);
        if (slug && !bySlug.has(slug)) bySlug.set(slug, { platform: slug, label: s.platformDisplay || formatPlatformLabel(s.platform), color: s.color });
      });
    });
    return {
      platformsInView: [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr')),
      hasClosures: closures,
    };
  }, [cache.entries]);

  // The legend is folded behind « Légende »: the colours are learnt once, the stays every day.
  const [legendOpen, setLegendOpen] = useState(false);

  const legendToggle = (platformsInView.length > 0 || hasClosures) ? (
    <Button
      size="small"
      variant="text"
      onClick={() => setLegendOpen((v) => !v)}
      aria-expanded={legendOpen}
      aria-controls="cumulative-calendar-legend"
      endIcon={<ExpandMoreIcon sx={{ transition: 'transform 200ms ease-out', transform: legendOpen ? 'rotate(180deg)' : 'none', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />}
      sx={{ minHeight: 44 }}
    >
      Légende
    </Button>
  ) : null;

  return (
    <InfiniteMonthScroller
      cache={cache}
      initialMonth={initialMonth}
      onVisibleMonthChange={onVisibleMonthChange}
      toolbarEnd={legendToggle}
      belowToolbar={(
        <Collapse in={legendOpen} unmountOnExit>
          <Stack id="cumulative-calendar-legend" direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
            {platformsInView.map(({ platform, label, color }) => (
              <Stack key={platform} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 14, height: 12, borderRadius: 0.5, bgcolor: color }} />
                <Typography variant="caption" color="text.secondary">{label}</Typography>
              </Stack>
            ))}
            {hasClosures && (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 14, height: 12, borderRadius: 0.5, backgroundImage: closureHatch(theme), border: '1px solid', borderColor: 'divider' }} />
                <Typography variant="caption" color="text.secondary">Fermeture</Typography>
              </Stack>
            )}
          </Stack>
        </Collapse>
      )}
      minWidth={{ xs: 'auto', sm: CALENDAR_MIN_WIDTH }}
      renderMonth={({ year, month, data }) => (
        <MonthBlock
          year={year}
          month={month}
          data={data}
          todayStr={todayStr}
          isMobile={isMobile}
          onReservationClick={onReservationClick}
          onCreateReservation={onCreateReservation}
        />
      )}
    />
  );
}
