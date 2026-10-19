// specs/plugins-phase-0-foundation.md rule 26 — « Configurer » lands on its plugin: the anchor is placed
// below the measured sticky bars once it exists, put back in place while the page grows above it, and
// left alone as soon as the user scrolls.
import React, { useState } from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import useAnchorScroll from '../useAnchorScroll';

let observers = [];
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; observers.push(this); }
  observe() {}
  disconnect() { this.cb = null; }
  fire() { if (this.cb) this.cb([]); }
}

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
function Page({ hash }) {
  const [shown, setShown] = useState(false);
  showAnchor = () => setShown(true);
  useAnchorScroll(hash, { prefix: '#plugin-' });
  return (
    <div>
      <div data-sticky-bar="" style={{ position: 'sticky', top: '64px' }} />
      {shown && <div id="plugin-neat">Neat</div>}
    </div>
  );
}

test('rule 26: the anchor is waited for, then placed with a measured scroll margin', () => {
  render(<Page hash="#plugin-neat" />);
  expect(scrolls).toBe(0);
  act(() => { showAnchor(); });
  act(() => { vi.advanceTimersByTime(60); });
  expect(scrolls).toBe(1);
  expect(document.getElementById('plugin-neat').style.scrollMarginTop).toBe('72px');
});

test('rule 26: a later layout change puts it back; a user scroll ends that', () => {
  render(<Page hash="#plugin-neat" />);
  act(() => { showAnchor(); });
  act(() => { vi.advanceTimersByTime(60); });
  act(() => observers[0].fire());
  expect(scrolls).toBe(2);
  act(() => { window.dispatchEvent(new Event('wheel')); });
  act(() => observers[0].fire());
  expect(scrolls).toBe(2);
});

test('rule 26: after the settle time the page is left alone', () => {
  render(<Page hash="#plugin-neat" />);
  act(() => { showAnchor(); });
  act(() => { vi.advanceTimersByTime(60); });
  act(() => { vi.advanceTimersByTime(2000); });
  act(() => observers[0].fire());
  expect(scrolls).toBe(1);
});

test('rule 26: another hash is not an anchor of this page', () => {
  render(<Page hash="#general" />);
  act(() => { showAnchor(); });
  act(() => { vi.advanceTimersByTime(200); });
  expect(scrolls).toBe(0);
});
