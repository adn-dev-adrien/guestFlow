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
 *   stickyHeader?:          ReactNode under each month title, sticking with it (a weekday header…).
 *   todaySelector?:         CSS selector of today's row inside a block: « Aujourd'hui » and the first opening on the
 *                           current month put that row right under the sticky title (a day agenda, the week in
 *                           progress). Until the user scrolls, that row stays put while the months load and grow.
 *   today?:                 'YYYY-MM-DD' — the day the caller marks as today (the server's); default: the device's.
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

// Below a block's sticky header (title, plus the weekday names when the caller adds them).
function titleClearance(block) {
  const header = block && block.firstElementChild;
  return Math.max(STICKY_TITLE_CLEARANCE, header ? header.getBoundingClientRect().height + 4 : 0);
}

function rowTopIn(el, selector) {
  const row = el.querySelector(selector);
  return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
}

function MonthBlock({ year, month, entry, onRetry, stickyHeader, children }) {
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
        {stickyHeader}
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
  cache, renderMonth, initialMonth, onVisibleMonthChange, toolbarEnd = null, belowToolbar = null, stickyHeader = null,
  todaySelector, today, minWidth, sx,
}) {
  const { months, scrollRef, handleScroll, focusOnMonth } = useInfiniteMonthScroll('months');
  const { scopeKey, entries, ensure, retry } = cache;
  const viewedRef = useRef(null);
  const anchorRef = useRef(null);
  const frameRef = useRef(0);
  const focusFrameRef = useRef(0);
  // Today's row is awaited: it only exists once its month's data has landed (a phone agenda).
  const awaitingRowRef = useRef(false);
  // The month the caller's today falls in: the scroller must aim at the block where the row is marked.
  const todayRef = useRef(today);
  todayRef.current = today;
  const currentMonth = useCallback(() => {
    if (todayRef.current) {
      const [y, m] = todayRef.current.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, []);
  const onVisibleRef = useRef(onVisibleMonthChange);
  onVisibleRef.current = onVisibleMonthChange;

  // Where today's row (when the view has such rows) sits right under the sticky title of its month.
  const todayRowPlace = useCallback(() => {
    const el = scrollRef.current;
    const row = todaySelector && el ? el.querySelector(todaySelector) : null;
    if (!row) return null;
    const clearance = titleClearance(row.closest('[data-month-anchor]'));
    return { scrollTop: row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - clearance, clearance };
  }, [scrollRef, todaySelector]);
  const todayRowTop = useCallback(() => {
    const place = todayRowPlace();
    return place ? place.scrollTop : null;
  }, [todayRowPlace]);

  const pinTodayRow = useCallback(() => {
    const el = scrollRef.current;
    const place = todayRowPlace();
    if (!place || !el) return false;
    el.scrollTop = Math.max(0, place.scrollTop);
    // The row, not its month, is what must stay in view: the weeks above it grow as their stays land. The
    // anchor is where the row belongs, not where it landed: months still empty may cap the scroll for now.
    // `seen` is where the row actually is after this write: a scroll that moves it is the user's.
    anchorRef.current = { selector: todaySelector, top: place.clearance + Math.min(0, place.scrollTop), seen: rowTopIn(el, todaySelector) };
    return true;
  }, [scrollRef, todayRowPlace, todaySelector]);

  const focus = useCallback((year, month) => {
    anchorRef.current = null;
    awaitingRowRef.current = false;
    focusOnMonth(year, month);
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      const now = currentMonth();
      if (year === now.year && month === now.month && todaySelector) {
        if (pinTodayRow()) return;
        awaitingRowRef.current = true;
      }
      recordAnchor();
    });
  }, [focusOnMonth, pinTodayRow, todaySelector, currentMonth]);

  // The first block whose bottom is below the sticky title is « the month in view »; its offset is
  // remembered so a block above it that grows once its data lands does not push the view away.
  function recordAnchor() {
    const el = scrollRef.current;
    if (!el) return;
    // A row anchor outlives the scrolls of its own corrections; a scroll that moves the row releases it,
    // whatever caused it (wheel, touch, scrollbar, a focused bar brought into view).
    const pinned = anchorRef.current;
    if (pinned && pinned.selector) {
      // A row briefly absent (re-rendered for another breakpoint) keeps its anchor until it is back.
      const now = rowTopIn(el, pinned.selector);
      if (now == null || pinned.seen == null || Math.abs(now - pinned.seen) <= 1) return;
      anchorRef.current = null;
    }
    const top = el.getBoundingClientRect().top;
    // Same test while the row is awaited, on the month anchor: a scroll that moved the view ends the wait.
    const held = anchorRef.current;
    if (awaitingRowRef.current && held && held.key) {
      const block = el.querySelector(`[data-month-anchor="${held.key}"]`);
      if (!block || Math.abs(block.getBoundingClientRect().top - top - held.top) > 1) awaitingRowRef.current = false;
    }
    const blocks = el.querySelectorAll('[data-month-anchor]');
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > top + titleClearance(block)) {
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
    const start = initialMonth || currentMonth();
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
    if (awaitingRowRef.current) {
      if (pinTodayRow()) {
        awaitingRowRef.current = false;
        return;
      }
      // Today's month has landed without the row (no stay left this month): stop waiting for it.
      const { year, month } = currentMonth();
      const entry = entries[`${year}-${month}`];
      if (entry && entry.status !== 'loading') awaitingRowRef.current = false;
    }
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const target = el.querySelector(anchor.selector || `[data-month-anchor="${anchor.key}"]`);
    if (!target) return;
    const drift = (target.getBoundingClientRect().top - el.getBoundingClientRect().top) - anchor.top;
    if (Math.abs(drift) > 1) el.scrollTop += drift;
    if (anchor.selector) anchor.seen = rowTopIn(el, anchor.selector);
  }, [entries, scrollRef, pinTodayRow, currentMonth]);

  const goToday = useCallback(() => {
    const now = currentMonth();
    const el = scrollRef.current;
    const block = el && el.querySelector(`[data-month-anchor="${now.year}-${now.month}"]`);
    if (block) {
      const rowTop = todayRowTop();
      const target = rowTop != null
        ? rowTop
        : block.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
      el.scrollTo({ top: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      focus(now.year, now.month);
    }
  }, [focus, scrollRef, todayRowTop, currentMonth]);

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
              <MonthBlock key={`${year}-${month}`} year={year} month={month} entry={entry} onRetry={() => retry(year, month)} stickyHeader={stickyHeader}>
                {renderMonth({ year, month, data: entry && entry.status === 'ready' ? entry.data : null, status: entry ? entry.status : 'loading' })}
              </MonthBlock>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
