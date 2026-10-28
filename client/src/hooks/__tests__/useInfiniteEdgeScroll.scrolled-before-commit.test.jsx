// specs/dashboard-planning-scroll.md rule 31 — the operator's own scroll between the hold and the commit
// (a wheel handler asks for a window before the browser applies the scroll) is kept: only the shift of the
// content is undone, so scrolling up never snaps the view back to the held item.
import React, { useState } from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import useInfiniteEdgeScroll from '../useInfiniteEdgeScroll';

const ITEM = 100;
let scrollY;
let controls;

function Harness({ initial }) {
  const [keys, setKeys] = useState(initial);
  const [version, setVersion] = useState(0);
  const { holdAnchor } = useInfiniteEdgeScroll({ enabled: false, version });
  controls = {
    holdAnchor,
    prepend: (more) => { setKeys((k) => [...more, ...k]); setVersion((v) => v + 1); },
  };
  return <div>{keys.map((k) => <div key={k} data-scroll-anchor={k}>{k}</div>)}</div>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  scrollY = 0;
  window.scrollTo = vi.fn(({ top }) => { scrollY = top; });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (!this.hasAttribute('data-scroll-anchor')) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const top = Array.from(this.parentElement.children).indexOf(this) * ITEM - scrollY;
    return { top, bottom: top + ITEM, left: 0, right: 0, width: 0, height: ITEM };
  });
});

test('rule 31 — a scroll made after the hold is not undone by the restore', () => {
  scrollY = 300;
  render(<Harness initial={['a', 'b', 'c', 'd', 'e', 'f', 'g']} />);
  act(() => {
    controls.holdAnchor();
    scrollY = 200; // the wheel lands after the hold
    controls.prepend(['x', 'y']);
  });
  // Two items (200 px) were added above; the operator moved 100 px up: 300 + 200 - 100.
  expect(scrollY).toBe(400);
  expect(document.querySelector('[data-scroll-anchor="d"]').getBoundingClientRect().top).toBe(100);
});

test('rule 31 — without any scroll in between, the held item stays where it was', () => {
  scrollY = 300;
  render(<Harness initial={['a', 'b', 'c', 'd', 'e', 'f', 'g']} />);
  act(() => {
    controls.holdAnchor();
    controls.prepend(['x', 'y']);
  });
  expect(scrollY).toBe(500);
  expect(document.querySelector('[data-scroll-anchor="d"]').getBoundingClientRect().top).toBe(0);
});
