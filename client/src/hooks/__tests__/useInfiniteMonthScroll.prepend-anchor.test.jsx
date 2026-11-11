// Spec: specs/cumulative-month-calendar.md rule 11 (2026-10-27 spec review, F11) — on a phone both edges
// are near at load, so a month is added above AND below in the same commit. The view was moved by the
// scroller's whole growth, appended months included, and the current month's first stay ended under the
// sticky month label. The month that was first must keep its place on screen.
import { act, renderHook } from '@testing-library/react';
import useInfiniteMonthScroll from '../useInfiniteMonthScroll';

const H = 100;

function setup() {
  let months = [];
  const hook = renderHook(() => {
    const api = useInfiniteMonthScroll('all');
    months = api.months;
    return api;
  });
  let top = 0;
  const keyOf = (m) => `${m.year}-${m.month}`;
  const anchor = (key) => {
    const i = months.findIndex((m) => keyOf(m) === key);
    if (i < 0) return null;
    return { getAttribute: () => key, getBoundingClientRect: () => ({ top: i * H - top }) };
  };
  const el = {
    clientHeight: 150,
    get scrollHeight() { return months.length * H; },
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(v, el.scrollHeight - el.clientHeight)); },
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: (selector) => {
      const match = /data-month-anchor="([^"]+)"/.exec(selector);
      if (match) return anchor(match[1]);
      return months.length ? anchor(keyOf(months[0])) : null;
    },
  };
  hook.result.current.scrollRef.current = el;
  return { hook, el, firstKey: () => keyOf(months[0]), screenTop: (key) => anchor(key).getBoundingClientRect().top };
}

it('a month added above and one below in the same pass leave the former first month where it was', () => {
  const { hook, el, firstKey, screenTop } = setup();
  const key = firstKey();
  act(() => { el.scrollTop = 50; });
  const before = screenTop(key);
  act(() => { hook.result.current.handleScroll(); });
  expect(hook.result.current.months.length).toBeGreaterThan(4);
  expect(screenTop(key)).toBe(before);
});
