// specs/cumulative-month-calendar.md rule 13 — the view opened on today's row keeps that row under the sticky
// title while the months load and grow, a row that only appears with its month's data is still reached, and
// the first gesture of the user hands the scroll back.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import InfiniteMonthScroller from '../InfiniteMonthScroller';
import useMonthDataCache from '../../hooks/useMonthDataCache';

// A fake layout: a month is 40 px of title, then 60 px empty or 600 px once loaded; today's row sits 400 px
// into the loaded current month (100 px before it loads, when `rowBeforeData`).
const TITLE = 40;
let scroller = null;
const scrollTops = new WeakMap();
const originalRect = Element.prototype.getBoundingClientRect;
const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

function layout() {
  const blocks = [...scroller.querySelectorAll('[data-month-anchor]')];
  let y = 0;
  const tops = new Map();
  for (const block of blocks) {
    tops.set(block, y);
    const loaded = block.querySelector('[data-loaded]');
    const row = block.querySelector('[data-row]');
    if (row) tops.set(row, y + TITLE + (loaded ? 400 : 10));
    y += TITLE + (loaded ? 600 : 60);
  }
  return { tops, height: y };
}

function Harness({ loadMonth, rowBeforeData = true }) {
  const cache = useMonthDataCache('all', loadMonth);
  return (
    <ThemeProvider theme={theme}>
      <InfiniteMonthScroller
        cache={cache}
        todaySelector="[data-row]"
        renderMonth={({ year, month, data }) => {
          const current = year === 2026 && month === 6;
          return (
            <div data-loaded={data ? 'true' : undefined}>
              {current && (data || rowBeforeData) && <div data-row="true">today</div>}
            </div>
          );
        }}
      />
    </ThemeProvider>
  );
}

describe('InfiniteMonthScroller — today\'s row stays pinned', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return scrollTops.get(this) || 0; },
      set(v) {
        const max = this === scroller ? Math.max(0, layout().height - 500) : 0;
        scrollTops.set(this, Math.max(0, Math.min(v, max)));
      },
    });
    Element.prototype.getBoundingClientRect = function rect() {
      if (!scroller || this === scroller || !scroller.contains(this)) return { top: 0, bottom: 0, height: 0 };
      const { tops } = layout();
      if (tops.has(this)) {
        const top = tops.get(this) - scroller.scrollTop;
        return { top, bottom: top + 60, height: 60 };
      }
      const owner = this.closest('[data-month-anchor]');
      if (owner && this === owner.firstElementChild) return { top: 0, bottom: TITLE, height: TITLE };
      return { top: 0, bottom: 0, height: 0 };
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    Element.prototype.getBoundingClientRect = originalRect;
    if (scrollTopDescriptor) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDescriptor);
    else delete Element.prototype.scrollTop;
    scroller = null;
  });

  async function open(props) {
    const pending = {};
    const loadMonth = vi.fn((y, m) => new Promise((resolve) => { pending[`${y}-${m}`] = resolve; }));
    const view = render(<Harness loadMonth={loadMonth} {...props} />);
    scroller = view.container.querySelector('[data-month-anchor]').parentElement.parentElement;
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
    const rowTop = () => view.container.querySelector('[data-row]').getBoundingClientRect().top;
    const land = async (key) => { await act(async () => { pending[key]({}); }); };
    return { view, rowTop, land, pending };
  }

  it('the row stays at the same place while the current month and the one above it load', async () => {
    const { rowTop, land } = await open();
    await land('2026-5');
    await land('2026-6');
    await land('2026-7');
    expect(rowTop()).toBe(48);
  });

  it('a row that only exists once its month has loaded is reached when it appears', async () => {
    const { view, rowTop, land } = await open({ rowBeforeData: false });
    expect(view.container.querySelector('[data-row]')).toBeNull();
    await land('2026-5');
    await land('2026-6');
    await land('2026-7');
    expect(rowTop()).toBe(48);
  });

  it('a gesture of the user releases the row: a later load no longer moves the view to it', async () => {
    const { rowTop, land } = await open();
    fireEvent.wheel(scroller);
    const before = rowTop();
    await land('2026-6');
    expect(rowTop()).not.toBe(48);
    expect(rowTop()).toBeGreaterThan(before);
  });
});
