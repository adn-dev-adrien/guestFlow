import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

function getMonthsRange(centerY, centerM, range = 3) {
  const result = [];
  for (let i = -range; i <= range; i++) {
    const d = new Date(centerY, centerM + i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return result;
}

function getInitialMonths() {
  const now = new Date();
  return getMonthsRange(now.getFullYear(), now.getMonth(), 1);
}

/**
 * useInfiniteMonthScroll — owns the visible `months` list and the imperative scroll machinery
 * (prepend/append on scroll, scroll-position maintenance, focus-scroll to a target month,
 * short-viewport auto-preload). Extracted verbatim from CalendarPage.
 *
 * @param {number|string} selectedProp currently-open property id (effects no-op while empty)
 * @returns {{
 *   months: {year:number,month:number}[],
 *   scrollRef: React.RefObject,
 *   handleScroll: () => void,
 *   prependMonth: () => void,
 *   appendMonth: () => void,
 *   focusOnMonth: (year:number, month:number, opts?:{resetNavLocks?:boolean}) => void,
 *   recenterToday: () => void,
 * }}
 */
export default function useInfiniteMonthScroll(selectedProp) {
  const [months, setMonths] = useState(getInitialMonths);
  const scrollRef = useRef(null);
  const prevScrollHeight = useRef(0);
  const shouldAdjustScroll = useRef(false);
  const focusMonthKeyRef = useRef('');
  const pendingFocusScrollRef = useRef(false);
  const initialScrollDone = useRef(false);
  const prependMonthLock = useRef(false);
  const appendMonthLock = useRef(false);
  const autoPreloadAttemptsRef = useRef(0);

  // Maintain scroll position when prepending months.
  useLayoutEffect(() => {
    if (shouldAdjustScroll.current && scrollRef.current) {
      const diff = scrollRef.current.scrollHeight - prevScrollHeight.current;
      scrollRef.current.scrollTop += diff;
      shouldAdjustScroll.current = false;
    }
  }, [months]);

  // Scroll the focused month into view.
  useLayoutEffect(() => {
    if (!pendingFocusScrollRef.current || !selectedProp || !scrollRef.current) return;

    const container = scrollRef.current;
    const key = focusMonthKeyRef.current;
    if (!key) {
      pendingFocusScrollRef.current = false;
      return;
    }

    const anchor = container.querySelector(`[data-month-anchor="${key}"]`);
    if (!anchor) return;

    const anchorTop = anchor.offsetTop;
    const topPadding = 12;
    container.scrollTop = Math.max(0, anchorTop - topPadding);
    pendingFocusScrollRef.current = false;
  }, [months, selectedProp]);

  // Mark initial load as done (calendar already loads month + 2 neighbours).
  useEffect(() => {
    if (initialScrollDone.current || !selectedProp) return;
    initialScrollDone.current = true;
  }, [selectedProp, months]);

  // Auto-preload neighbouring months when the viewport is too short to scroll.
  useLayoutEffect(() => {
    if (!selectedProp || !initialScrollDone.current || !scrollRef.current) return;
    const el = scrollRef.current;
    const isScrollable = el.scrollHeight > el.clientHeight + 1;
    if (isScrollable) return;
    if (autoPreloadAttemptsRef.current >= 3) return;

    autoPreloadAttemptsRef.current += 1;
    setMonths((prev) => {
      if (!prev.length) return prev;
      const first = prev[0];
      const last = prev[prev.length - 1];
      const prevDate = new Date(first.year, first.month - 1, 1);
      const nextDate = new Date(last.year, last.month + 1, 1);
      const previousMonth = { year: prevDate.getFullYear(), month: prevDate.getMonth() };
      const nextMonth = { year: nextDate.getFullYear(), month: nextDate.getMonth() };

      const alreadyHasPrevious = prev[0]?.year === previousMonth.year && prev[0]?.month === previousMonth.month;
      const alreadyHasNext = prev[prev.length - 1]?.year === nextMonth.year && prev[prev.length - 1]?.month === nextMonth.month;

      if (alreadyHasPrevious && alreadyHasNext) return prev;
      return [
        ...(alreadyHasPrevious ? [] : [previousMonth]),
        ...prev,
        ...(alreadyHasNext ? [] : [nextMonth]),
      ];
    });
  }, [selectedProp, months]);

  const prependMonth = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      prevScrollHeight.current = el.scrollHeight;
      shouldAdjustScroll.current = true;
    }
    setMonths((prev) => {
      const first = prev[0];
      if (!first) return prev;
      const d = new Date(first.year, first.month - 1, 1);
      const nextMonth = { year: d.getFullYear(), month: d.getMonth() };
      if (prev[0]?.year === nextMonth.year && prev[0]?.month === nextMonth.month) {
        return prev;
      }
      return [nextMonth, ...prev];
    });
  }, []);

  const appendMonth = useCallback(() => {
    setMonths((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const d = new Date(last.year, last.month + 1, 1);
      const nextMonth = { year: d.getFullYear(), month: d.getMonth() };
      if (prev[prev.length - 1]?.year === nextMonth.year && prev[prev.length - 1]?.month === nextMonth.month) {
        return prev;
      }
      return [...prev, nextMonth];
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !initialScrollDone.current) return;

    const topThreshold = 200;
    const bottomThreshold = 200;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    if (el.scrollTop >= topThreshold) {
      prependMonthLock.current = false;
    }

    if (distanceFromBottom >= bottomThreshold) {
      appendMonthLock.current = false;
    }

    if (el.scrollTop < topThreshold && !prependMonthLock.current) {
      prependMonthLock.current = true;
      prependMonth();
    }

    if (distanceFromBottom < bottomThreshold && !appendMonthLock.current) {
      appendMonthLock.current = true;
      appendMonth();
    }
  }, [prependMonth, appendMonth]);

  // Reset to a tight range around a target month and scroll it into view on next paint.
  const focusOnMonth = useCallback((year, month, { resetNavLocks = false } = {}) => {
    setMonths(getMonthsRange(year, month, 1));
    focusMonthKeyRef.current = `${year}-${month}`;
    pendingFocusScrollRef.current = true;
    initialScrollDone.current = false;
    autoPreloadAttemptsRef.current = 0;
    if (resetNavLocks) {
      prependMonthLock.current = false;
      appendMonthLock.current = false;
    }
  }, []);

  // Recentre on the current month (the "Aujourd'hui" button) without a focus-scroll pass.
  const recenterToday = useCallback(() => {
    const now = new Date();
    setMonths(getMonthsRange(now.getFullYear(), now.getMonth(), 1));
    initialScrollDone.current = false;
    prependMonthLock.current = false;
    appendMonthLock.current = false;
    autoPreloadAttemptsRef.current = 0;
  }, []);

  return { months, scrollRef, handleScroll, prependMonth, appendMonth, focusOnMonth, recenterToday };
}
