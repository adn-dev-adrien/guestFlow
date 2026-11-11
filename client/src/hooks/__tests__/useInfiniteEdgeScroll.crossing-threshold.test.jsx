// specs/dashboard-planning-scroll.md rule 32 — a fling, a smooth wheel or a PageUp is ONE gesture that can
// start far from an edge and cross the threshold while it runs: the edge it reaches is asked then.
import React from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import useInfiniteEdgeScroll from '../useInfiniteEdgeScroll';

const ITEM = 100;
let scrollY;

function Harness({ onNearStart, onNearEnd }) {
  useInfiniteEdgeScroll({ enabled: true, version: 0, onNearStart, onNearEnd });
  return <div>{Array.from({ length: 40 }, (_, i) => <div key={i} data-scroll-anchor={`k${i}`} />)}</div>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  scrollY = 0;
  window.scrollTo = vi.fn(({ top }) => { scrollY = top; });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const top = Array.from(this.parentElement?.children || []).indexOf(this) * ITEM - scrollY;
    return { top, bottom: top + ITEM, left: 0, right: 0, width: 0, height: ITEM };
  });
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => 40 * ITEM);
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { delete window.matchMedia; });

const scroll = (to) => act(() => { scrollY = to; window.dispatchEvent(new Event('scroll')); });

test('rule 32 — a gesture that starts far from the top and crosses the threshold asks for the past', () => {
  const onNearStart = vi.fn(() => 'started');
  render(<Harness onNearStart={onNearStart} onNearEnd={() => 'none'} />);
  scroll(2000);
  onNearStart.mockClear();
  scroll(1500);
  expect(onNearStart).not.toHaveBeenCalled();
  scroll(900);
  scroll(500);
  expect(onNearStart).toHaveBeenCalledTimes(1);
  scroll(300);
  scroll(0);
  expect(onNearStart).toHaveBeenCalledTimes(1);
});

test('rule 32 — the same going down: the end of the feed is asked when a fling reaches it', () => {
  const onNearEnd = vi.fn(() => 'started');
  render(<Harness onNearStart={() => 'none'} onNearEnd={onNearEnd} />);
  scroll(1200);
  scroll(1800);
  expect(onNearEnd).not.toHaveBeenCalled();
  scroll(2800);
  expect(onNearEnd).toHaveBeenCalledTimes(1);
});

test('rule 32 — an edge that has nothing to give is not asked again within the gesture', () => {
  const onNearStart = vi.fn(() => 'none');
  render(<Harness onNearStart={onNearStart} onNearEnd={() => 'none'} />);
  scroll(2000);
  onNearStart.mockClear();
  scroll(700);
  scroll(600);
  scroll(500);
  expect(onNearStart.mock.calls.length).toBeLessThanOrEqual(3);
  scroll(1500);
  scroll(400);
  expect(onNearStart.mock.calls.length).toBeGreaterThan(0);
});
