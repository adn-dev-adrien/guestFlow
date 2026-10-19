// specs/plugins-phase-0-foundation.md rules 26–27 — « Configurer » lands on its plugin: the anchor is
// placed below the measured sticky bars once it exists, put back in place while the page grows above
// it, until the page has been quiet for a moment (capped), or at once when the user scrolls; the same
// hash opened again runs it again; a malformed hash never throws.
import React, { useState } from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import useAnchorScroll, { anchorIdOf } from '../useAnchorScroll';

let observers = [];
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; observers.push(this); }
  observe() {}
  disconnect() { this.cb = null; }
  fire() { if (this.cb) this.cb([]); }
}
const lastObserver = () => observers[observers.length - 1];

let scrolls = 0;
beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  scrolls = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolls += 1; };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

let showAnchor;
function Page({ hash, navigationKey, initiallyShown = false }) {
  const [shown, setShown] = useState(initiallyShown);
  showAnchor = () => setShown(true);
  useAnchorScroll(hash, { prefix: '#plugin-', navigationKey });
  return (
    <div>
      <div data-sticky-bar="" style={{ position: 'sticky', top: '64px' }} />
      {shown && <div id="plugin-neat">Neat</div>}
    </div>
  );
}

const placeAnchor = () => {
  act(() => { showAnchor(); });
  act(() => { vi.advanceTimersByTime(60); });
};

test('rule 26: the anchor is waited for, then placed with a measured scroll margin', () => {
  render(<Page hash="#plugin-neat" />);
  expect(scrolls).toBe(0);
  placeAnchor();
  expect(scrolls).toBe(1);
  expect(document.getElementById('plugin-neat').style.scrollMarginTop).toBe('72px');
});

test('rule 26: a later layout change puts it back; a user scroll ends that', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  act(() => lastObserver().fire());
  expect(scrolls).toBe(2);
  act(() => { window.dispatchEvent(new Event('wheel')); });
  act(() => lastObserver().fire());
  expect(scrolls).toBe(2);
});

test('rule 27: it stops 800 ms after the LAST layout change, not at a fixed time', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  for (let i = 0; i < 5; i += 1) {
    act(() => { vi.advanceTimersByTime(600); });
    act(() => lastObserver().fire());
  }
  expect(scrolls).toBe(6);
  act(() => { vi.advanceTimersByTime(900); });
  act(() => lastObserver().fire());
  expect(scrolls).toBe(6);
});

test('rule 27: a page that never settles is let go after 8 s', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  for (let i = 0; i < 20; i += 1) {
    act(() => { vi.advanceTimersByTime(500); });
    act(() => lastObserver().fire());
  }
  const after = scrolls;
  act(() => lastObserver().fire());
  expect(scrolls).toBe(after);
  expect(after).toBeLessThan(21);
});

const scrollTo = (y) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
};

test('rule 27: a scroll with no layout change behind it (the scrollbar dragged) ends it', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  act(() => { vi.advanceTimersByTime(300); });
  act(() => scrollTo(300));
  act(() => lastObserver().fire());
  expect(scrolls).toBe(1);
  scrollTo(0);
});

test('rule 27: a scroll right after a layout change is the browser’s: the anchor is placed again', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  act(() => { vi.advanceTimersByTime(300); });
  act(() => lastObserver().fire());
  expect(scrolls).toBe(2);
  act(() => scrollTo(318));
  expect(scrolls).toBe(3);
  act(() => lastObserver().fire());
  expect(scrolls).toBe(4);
  scrollTo(0);
});

test('rule 27: the same hash opened again (a new navigation key) runs it again', () => {
  const { rerender } = render(<Page hash="#plugin-neat" navigationKey="a" initiallyShown />);
  act(() => { vi.advanceTimersByTime(2000); });
  expect(scrolls).toBe(1);
  rerender(<Page hash="#plugin-neat" navigationKey="b" initiallyShown />);
  expect(scrolls).toBe(2);
});

test('rule 27: a malformed hash is read as typed, never thrown', () => {
  expect(anchorIdOf('#plugin-%E0%A4%A')).toBe('plugin-%E0%A4%A');
  expect(anchorIdOf('#plugin-m%C3%A9t%C3%A9o')).toBe('plugin-météo');
  expect(() => render(<Page hash="#plugin-%E0%A4%A" />)).not.toThrow();
  act(() => { vi.advanceTimersByTime(200); });
  expect(scrolls).toBe(0);
});

test('rule 26: another hash is not an anchor of this page', () => {
  render(<Page hash="#general" />);
  placeAnchor();
  expect(scrolls).toBe(0);
});

test('rule 27: what comes before the anchor leaves the browser scroll anchoring, until the user takes over', () => {
  render(<Page hash="#plugin-neat" />);
  placeAnchor();
  const bar = document.querySelector('[data-sticky-bar]');
  expect(bar.style.overflowAnchor).toBe('none');
  act(() => { window.dispatchEvent(new Event('touchstart')); });
  expect(bar.style.overflowAnchor).toBe('');
});
