/**
 * InfiniteMonthScroller — stacked month blocks in one bounded scroll container, extended without limit
 * in both directions, each block under its own sticky month title (specs/calendar-property-parity.md
 * rules 13-15). It owns the scrolling, the « Aujourd'hui » button and the loading/error state of each
 * month; WHAT a month shows is the caller's `renderMonth`, and its data comes from a `useMonthDataCache`.
 *
 * Generic on purpose: the two calendars use it, and any other month-by-month view can (Planning next).
 *
 * Props:
 *   cache:                  the object returned by `useMonthDataCache` — one fetch per month, kept per scope.
 *   renderMonth:            ({ year, month, data, status }) => ReactNode. `month` is 0-based; `data` is null
 *                           until the month is loaded (render the empty block meanwhile).
 *   initialMonth?:          { year, month } to open on (default: the current month).
 *   onVisibleMonthChange?:  ({ year, month }) => void — the month under the sticky title, as the user scrolls.
 *   toolbarEnd?:            ReactNode on the right of the « Aujourd'hui » button (a legend toggle…).
 *   belowToolbar?:          ReactNode between the toolbar and the months (the legend it toggles…).
 *   todaySelector?:         CSS selector of today's row inside a block: « Aujourd'hui » and the first opening on the
 *                           current month put that row right under the sticky title (a day agenda).
 *   minWidth?:              CSS min-width of the blocks, so a narrow screen scrolls sideways instead of squashing them.
 *   sx?:                    extra styles for the scroll container (height…).
 * A change of `cache.scopeKey` keeps the month that was in view.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ErrorAlert from './ErrorAlert';
import useInfiniteMonthScroll from '../hooks/useInfiniteMonthScroll';
import { MONTH_NAMES } from '../utils/calendarVisuals';

const STICKY_TITLE_CLEARANCE = 48;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

function MonthBlock({ year, month, entry, onRetry, children }) {
  const loading = !entry || entry.status === 'loading';
  return (
    <Box data-month-anchor={`${year}-${month}`} sx={{ mb: 2 }}>
      <Box
        sx={{
          position: 'sticky', top: 0, zIndex: 6, bgcolor: 'background.paper', pt: 0.5,
          borderBottom: '2px solid', borderColor: 'primary.light',
        }}
      >
        <Typography variant="sectionHeader" sx={{ display: 'block', pb: 0.5, textTransform: 'capitalize' }}>
          {MONTH_NAMES[month]} {year}
        </Typography>
        {loading && (
          <Box
            role="progressbar"
            aria-label={`Chargement de ${MONTH_NAMES[month].toLowerCase()} ${year}`}
            sx={{
              position: 'absolute', left: 0, bottom: -2, height: 2, width: 64, borderRadius: 1, bgcolor: 'primary.main',
              animation: 'monthLoading 900ms ease-in-out infinite alternate',
              '@keyframes monthLoading': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(180px)' } },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          />
        )}
      </Box>
      {entry && entry.status === 'error'
        ? <ErrorAlert message="Ce mois n'a pas pu être chargé." onRetry={onRetry} sx={{ mt: 1 }} />
        : children}
    </Box>
  );
}

export default function InfiniteMonthScroller({
  cache, renderMonth, initialMonth, onVisibleMonthChange, toolbarEnd = null, belowToolbar = null, todaySelector, minWidth, sx,
}) {
  const { months, scrollRef, handleScroll, focusOnMonth } = useInfiniteMonthScroll('months');
  const { scopeKey, entries, ensure, retry } = cache;
  const viewedRef = useRef(null);
  const anchorRef = useRef(null);
  const frameRef = useRef(0);
  const focusFrameRef = useRef(0);
  const onVisibleRef = useRef(onVisibleMonthChange);
  onVisibleRef.current = onVisibleMonthChange;

  // Puts today's row (when the view has such rows) right under the sticky title of its month.
  const todayRowTop = useCallback(() => {
    const el = scrollRef.current;
    const row = todaySelector && el ? el.querySelector(todaySelector) : null;
    if (!row) return null;
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - STICKY_TITLE_CLEARANCE;
  }, [scrollRef, todaySelector]);

  const focus = useCallback((year, month) => {
    anchorRef.current = null;
    focusOnMonth(year, month);
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      const now = new Date();
      if (year === now.getFullYear() && month === now.getMonth()) {
        const top = todayRowTop();
        if (top != null && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, top);
      }
      recordAnchor();
    });
  }, [focusOnMonth, todayRowTop, scrollRef]);

  // The first block whose bottom is below the sticky title is « the month in view »; its offset is
  // remembered so a block above it that grows once its data lands does not push the view away.
  function recordAnchor() {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const blocks = el.querySelectorAll('[data-month-anchor]');
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > top + STICKY_TITLE_CLEARANCE) {
        const key = block.getAttribute('data-month-anchor');
        anchorRef.current = { key, top: rect.top - top };
        const [year, month] = key.split('-').map(Number);
        const last = viewedRef.current;
        if (!last || last.year !== year || last.month !== month) {
          viewedRef.current = { year, month };
          if (onVisibleRef.current) onVisibleRef.current({ year, month });
        }
        return;
      }
    }
  }

  const onScroll = useCallback(() => {
    handleScroll();
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(recordAnchor);
  }, [handleScroll]);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    cancelAnimationFrame(focusFrameRef.current);
  }, []);

  useEffect(() => {
    const now = new Date();
    const start = initialMonth || { year: now.getFullYear(), month: now.getMonth() };
    viewedRef.current = start;
    focus(start.year, start.month);
    // Opened once; a later `initialMonth` is not a request to move.
  }, []);

  // Another scope (a logement) shows the month that was in view.
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    const viewed = viewedRef.current;
    if (viewed) focus(viewed.year, viewed.month);
  }, [scopeKey, focus]);

  // Each rendered month asks for its data once.
  useEffect(() => {
    months.forEach(({ year, month }) => ensure(year, month));
  }, [months, scopeKey, ensure]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const block = el.querySelector(`[data-month-anchor="${anchor.key}"]`);
    if (!block) return;
    const drift = (block.getBoundingClientRect().top - el.getBoundingClientRect().top) - anchor.top;
    if (Math.abs(drift) > 1) el.scrollTop += drift;
  }, [entries, scrollRef]);

  const goToday = useCallback(() => {
    const now = new Date();
    const el = scrollRef.current;
    const block = el && el.querySelector(`[data-month-anchor="${now.getFullYear()}-${now.getMonth()}"]`);
    if (block) {
      const rowTop = todayRowTop();
      const target = rowTop != null
        ? rowTop
        : block.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
      el.scrollTo({ top: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      focus(now.getFullYear(), now.getMonth());
    }
  }, [focus, scrollRef, todayRowTop]);

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Button onClick={goToday} size="small" variant="outlined" sx={{ minHeight: 44 }}>Aujourd'hui</Button>
        {toolbarEnd}
      </Stack>
      {belowToolbar}
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        sx={{
          overflowY: 'auto', overflowX: { xs: 'visible', sm: 'auto' }, pr: 0.5, overscrollBehavior: 'contain',
          maxHeight: { xs: '74vh', sm: 'calc(100vh - 240px)' },
          ...sx,
        }}
      >
        <Box sx={{ minWidth }}>
          {months.map(({ year, month }) => {
            const entry = entries[`${year}-${month}`];
            return (
              <MonthBlock key={`${year}-${month}`} year={year} month={month} entry={entry} onRetry={() => retry(year, month)}>
                {renderMonth({ year, month, data: entry && entry.status === 'ready' ? entry.data : null, status: entry ? entry.status : 'loading' })}
              </MonthBlock>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
