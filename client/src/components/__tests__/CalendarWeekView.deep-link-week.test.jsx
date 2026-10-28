// specs/calendar-mobile-view.md rule 7 (2026-10-27 spec review, F12) — a deep link mounted the week strip
// while it was 0 px wide: the landing scroll was lost and the strip sat on its first week (« 1 – 7 juin »).
// The landing position is re-applied once the strip has a width.
import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';

import CalendarWeekView from '../CalendarWeekView';

let width = 0;
let observed = null;
beforeEach(() => {
  width = 0;
  observed = null;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  window.ResizeObserver = class {
    constructor(callback) { observed = callback; }
    observe() {}
    disconnect() {}
  };
});
afterEach(() => {
  delete HTMLElement.prototype.clientWidth;
  delete window.ResizeObserver;
});

test("the strip lands on today's week once it gets a width", () => {
  const { container } = render(
    <CalendarWeekView
      today="2026-10-27"
      reservations={[]}
      selectedProp={1}
      onReservationClick={vi.fn()}
      onDevisClick={vi.fn()}
      onOpenNewReservation={vi.fn()}
      onOpenNote={vi.fn()}
      onWeekChange={vi.fn()}
    />,
  );
  const strip = [...container.querySelectorAll('div')].find((d) => d.children.length === 53);
  expect(strip.scrollLeft).toBe(0);
  width = 390;
  observed();
  expect(strip.scrollLeft).toBe(26 * 390);
});
