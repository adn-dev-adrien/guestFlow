// Spec: specs/cumulative-month-calendar.md rule 6 — the infinite scroll must not stall at its end when an
// appended month is shorter than the edge threshold (empty mobile agenda, fast wheel notch).
import { act, renderHook } from '@testing-library/react';
import useInfiniteMonthScroll from '../useInfiniteMonthScroll';

// A scroller whose content height follows the number of rendered months, clamped like a real one.
function fakeScroller(getMonthCount, { monthHeight, clientHeight }) {
  let top = 0;
  const el = {
    clientHeight,
    get scrollHeight() { return getMonthCount() * monthHeight; },
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(v, el.scrollHeight - clientHeight)); },
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: () => null,
  };
  return el;
}

function setup({ monthHeight, clientHeight }) {
  // Read the month count during render: layout effects run before `result.current` is refreshed.
  let monthCount = 0;
  const hook = renderHook(() => {
    const api = useInfiniteMonthScroll('all');
    monthCount = api.months.length;
    return api;
  });
  const el = fakeScroller(() => monthCount, { monthHeight, clientHeight });
  hook.result.current.scrollRef.current = el;
  const scrollToBottom = () => act(() => {
    el.scrollTop = el.scrollHeight;
    hook.result.current.handleScroll();
  });
  return { hook, el, scrollToBottom };
}

describe('useInfiniteMonthScroll — appending past the preloaded months', () => {
  it('chains short months until the scroller is clear of the bottom edge, from a single scroll event', () => {
    const { hook, el, scrollToBottom } = setup({ monthHeight: 120, clientHeight: 100 });
    scrollToBottom();
    expect(hook.result.current.months).toHaveLength(5);
    expect(el.scrollHeight - el.scrollTop - el.clientHeight).toBeGreaterThanOrEqual(200);
  });

  it('keeps appending on every return to the bottom, without first scrolling away from it', () => {
    const { hook, scrollToBottom } = setup({ monthHeight: 120, clientHeight: 100 });
    scrollToBottom();
    scrollToBottom();
    scrollToBottom();
    expect(hook.result.current.months).toHaveLength(9);
  });

  it('bounds the chain when the months take no height', () => {
    const { hook, scrollToBottom } = setup({ monthHeight: 0, clientHeight: 100 });
    const before = hook.result.current.months.length;
    scrollToBottom();
    // Per edge: the requested month + at most 6 chained re-checks + the 3 short-viewport preloads.
    expect(hook.result.current.months.length).toBeLessThanOrEqual(before + 2 * (1 + 6 + 3));
  });
});
