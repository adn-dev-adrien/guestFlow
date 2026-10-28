// specs/dashboard-planning-scroll.md rules 13, 18, 19 — the shared edge-scroll hook, on the window and on an
// element scroller: edges ask for more, a prepend or a release above keeps the first visible item in place,
// the chain is bounded, and « scroll to a key » is instant under reduced motion.
import React, { useRef, useState } from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import useInfiniteEdgeScroll from '../useInfiniteEdgeScroll';

const ITEM = 100;
const VIEWPORT = 600;
let scrollY;
let scrollTo;
let controls;

// jsdom has no layout: items are 100 px tall, stacked from the top of the scroller, shifted by its scroll.
function installGeometry() {
  scrollY = 0;
  scrollTo = vi.fn(({ top }) => { scrollY = top; });
  window.scrollTo = scrollTo;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.hasAttribute('data-scroll-anchor')) {
      const index = Array.from(this.parentElement.children).indexOf(this);
      const base = this.closest('[data-scroller]') ? -this.closest('[data-scroller]').scrollTop : -scrollY;
      const top = index * ITEM + base;
      return { top, bottom: top + ITEM, left: 0, right: 0, width: 0, height: ITEM };
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  });
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(
    () => document.querySelectorAll('[data-scroll-anchor]').length * ITEM,
  );
}

function Harness({ initial, onNearStart, onNearEnd, element = false, maxChain }) {
  const [keys, setKeys] = useState(initial);
  const [version, setVersion] = useState(0);
  const scrollerRef = useRef(null);
  const { holdAnchor, scrollToAnchor, pinAnchor } = useInfiniteEdgeScroll({
    scrollerRef: element ? scrollerRef : undefined,
    enabled: true,
    version,
    maxChain,
    onNearStart: () => onNearStart?.(controls) ?? 'none',
    onNearEnd: () => onNearEnd?.(controls) ?? 'none',
  });
  controls = {
    keys,
    scrollToAnchor,
    pinAnchor,
    prepend: (more) => { holdAnchor(); setKeys((k) => [...more, ...k]); setVersion((v) => v + 1); },
    append: (more) => { setKeys((k) => [...k, ...more]); setVersion((v) => v + 1); },
    release: (n) => { holdAnchor(); setKeys((k) => k.slice(n)); setVersion((v) => v + 1); },
    scrollerRef,
  };
  const items = keys.map((k) => <div key={k} data-scroll-anchor={k} style={{ height: ITEM }}>{k}</div>);
  return element ? <div ref={scrollerRef} data-scroller style={{ height: VIEWPORT, overflow: 'auto' }}>{items}</div> : <div>{items}</div>;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `k${from + i}`);

beforeEach(() => {
  vi.restoreAllMocks();
  installGeometry();
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { delete window.matchMedia; });

const scroll = (to) => act(() => { scrollY = to; window.dispatchEvent(new Event('scroll')); });

test('rule 13 — the nearer edge is asked within the threshold; in the middle of a long feed nothing is', () => {
  const onNearStart = vi.fn(() => 'none');
  const onNearEnd = vi.fn(() => 'none');
  render(<Harness initial={range(1, 40)} onNearStart={onNearStart} onNearEnd={onNearEnd} />);
  scroll(1500);
  onNearStart.mockClear();
  onNearEnd.mockClear();
  scroll(1600);
  expect(onNearStart).not.toHaveBeenCalled();
  expect(onNearEnd).not.toHaveBeenCalled();
  scroll(700);
  expect(onNearStart).toHaveBeenCalledTimes(1);
  expect(onNearEnd).not.toHaveBeenCalled();
  scroll(3000);
  expect(onNearEnd).toHaveBeenCalled();
});

test('rule 13 — a prepend keeps the first visible item where it was on the window', () => {
  render(<Harness initial={range(10, 49)} />);
  scroll(1000);
  scrollTo.mockClear();
  // k20 sits at index 10 → top = 0 (scroll 1000): the first visible item.
  act(() => controls.prepend(range(1, 3)));
  expect(scrollTo).toHaveBeenCalledWith({ top: 1300, behavior: 'instant' });
  const kept = document.querySelector('[data-scroll-anchor="k20"]');
  expect(kept.getBoundingClientRect().top).toBe(0);
});

test('rule 13 — the same on an element scroller', () => {
  render(<Harness initial={range(10, 49)} element />);
  const scroller = document.querySelector('[data-scroller]');
  scroller.scrollTo = vi.fn(({ top }) => { scroller.scrollTop = top; });
  scroller.scrollTop = 1000;
  act(() => controls.prepend(range(1, 3)));
  expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1300, behavior: 'instant' });
  expect(window.scrollTo).not.toHaveBeenCalled();
});

test('rule 13 — the chain stops after the bound when each new item leaves the scroller within the threshold', () => {
  const onNearEnd = vi.fn((c) => { c.append([`more${onNearEnd.mock.calls.length}`]); return 'started'; });
  render(<Harness initial={range(1, 4)} onNearEnd={onNearEnd} maxChain={4} />);
  // Enabled with a short feed: the first request and three chained ones, then it waits for a scroll gesture.
  expect(onNearEnd).toHaveBeenCalledTimes(4);
  scroll(10);
  expect(onNearEnd).toHaveBeenCalledTimes(8);
});

test('rule 19 — releasing items above keeps the view in place', () => {
  render(<Harness initial={range(1, 40)} />);
  scroll(1000);
  scrollTo.mockClear();
  act(() => controls.release(2));
  expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'instant' });
  expect(document.querySelector('[data-scroll-anchor="k11"]').getBoundingClientRect().top).toBe(0);
});

test('rule 18 — scrollToAnchor brings the item to the top offset; smooth is instant under reduced motion', () => {
  render(<Harness initial={range(1, 40)} />);
  scrollTo.mockClear();
  act(() => { controls.scrollToAnchor('k21', { behavior: 'smooth' }); });
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'smooth' });
  window.matchMedia = (query) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} });
  act(() => { controls.scrollToAnchor('k21', { behavior: 'smooth' }); });
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'instant' });
  expect(controls.scrollToAnchor('missing')).toBe(false);
});

test('rule 25 — the scroll event of the hook\'s own anchoring is not a gesture: it does not restart the chain', () => {
  const onNearStart = vi.fn(() => 'none');
  render(<Harness initial={range(10, 49)} onNearStart={onNearStart} />);
  scroll(300);
  onNearStart.mockClear();
  act(() => controls.prepend(range(1, 3)));
  expect(scrollY).toBe(600);
  act(() => { window.dispatchEvent(new Event('scroll')); });
  expect(onNearStart).not.toHaveBeenCalled();
  scroll(500);
  expect(onNearStart).toHaveBeenCalledTimes(1);
});

test('rule 24 — a pinned item stays at the top offset while the feed grows above it, until the operator acts', () => {
  const resizes = [];
  const original = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(cb) { this.on = true; resizes.push(() => { if (this.on) cb(); }); }

    observe() {}

    disconnect() { this.on = false; }
  };
  render(<Harness initial={range(1, 40)} />);
  act(() => { controls.pinAnchor('k21'); });
  expect(scrollY).toBe(2000);
  // Three items render late above k21: it is now 300 px lower than where it was pinned.
  act(() => { controls.keys.unshift('x1', 'x2', 'x3'); });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.hasAttribute('data-scroll-anchor')) {
      const index = this.getAttribute('data-scroll-anchor') === 'k21' ? 23 : 0;
      const top = index * ITEM - scrollY;
      return { top, bottom: top + ITEM, left: 0, right: 0, width: 0, height: ITEM };
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  });
  scrollTo.mockClear();
  act(() => resizes.at(-1)());
  expect(scrollTo).toHaveBeenCalledWith({ top: 2300, behavior: 'instant' });
  act(() => { window.dispatchEvent(new Event('wheel')); });
  scrollTo.mockClear();
  act(() => resizes.at(-1)());
  expect(scrollTo).not.toHaveBeenCalled();
  global.ResizeObserver = original;
});

test('rule 18 — a smooth scroll that rests off target is corrected once, and operator input cancels the correction', () => {
  vi.useFakeTimers();
  try {
    render(<Harness initial={range(1, 40)} />);
    act(() => { controls.scrollToAnchor('k21', { behavior: 'smooth' }); });
    expect(scrollY).toBe(2000);
    // Windows were added above while it ran: k21 now sits 300 px lower than where the scroll aimed.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (!this.hasAttribute('data-scroll-anchor')) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const index = this.getAttribute('data-scroll-anchor') === 'k21' ? 23 : 0;
      const top = index * ITEM - scrollY;
      return { top, bottom: top + ITEM, left: 0, right: 0, width: 0, height: ITEM };
    });
    scrollTo.mockClear();
    act(() => { window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(200); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 2300, behavior: 'instant' });

    act(() => { controls.scrollToAnchor('k21', { behavior: 'smooth' }); });
    scrollTo.mockClear();
    act(() => { window.dispatchEvent(new Event('wheel')); window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(400); });
    expect(scrollTo).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
