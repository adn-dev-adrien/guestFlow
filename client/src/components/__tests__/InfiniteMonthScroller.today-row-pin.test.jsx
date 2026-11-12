// specs/cumulative-month-calendar.md rule 13 — the view opened on today's row keeps that row under the sticky
// header while the months load and grow, a row that only appears with its month's data is still reached, and
// the first scroll that moves the row hands the scroll back.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import InfiniteMonthScroller from '../InfiniteMonthScroller';
import useMonthDataCache from '../../hooks/useMonthDataCache';

// A fake layout: a month is a 70 px sticky header (title + weekday names, taller than the former fixed 48 px
// clearance), then 60 px empty or 600 px once loaded; today's row sits 400 px into the loaded current month
// (10 px before it loads, when `rowBeforeData`). The row belongs at 70 + 4 = 74 px from the top.
const TITLE = 70;
const PLACE = TITLE + 4;
let scroller = null;
const scrollTops = new WeakMap();
const originalRect = Element.prototype.getBoundingClientRect;
const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
const VIEWPORT = 500;

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

function Harness({ loadMonth, rowBeforeData = true, rowAfterData = true }) {
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
              {current && (data ? rowAfterData : rowBeforeData) && <div data-row="true">today</div>}
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
        const max = this === scroller ? Math.max(0, layout().height - VIEWPORT) : 0;
        scrollTops.set(this, Math.max(0, Math.min(v, max)));
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true, get() { return this === scroller ? VIEWPORT : 0; },
    });
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true, get() { return this === scroller ? layout().height : 0; },
    });
    Element.prototype.scrollTo = function scrollTo({ top }) { this.scrollTop = top; };
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
    [['scrollTop', scrollTopDescriptor], ['clientHeight', clientHeightDescriptor], ['scrollHeight', scrollHeightDescriptor]]
      .forEach(([name, descriptor]) => {
        if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
        else delete Element.prototype[name];
      });
    delete Element.prototype.scrollTo;
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
    const scrollBy = async (dy) => {
      await act(async () => {
        scroller.scrollTop += dy;
        fireEvent.scroll(scroller);
        await new Promise((r) => requestAnimationFrame(r));
      });
    };
    return { view, rowTop, land, pending, scrollBy };
  }

  it('the row stays at the same place while the current month and the one above it load', async () => {
    const { rowTop, land } = await open();
    await land('2026-5');
    await land('2026-6');
    await land('2026-7');
    expect(rowTop()).toBe(PLACE);
  });

  it('a scroll event the view caused itself (no move of the row) keeps the pin', async () => {
    const { rowTop, land, scrollBy } = await open();
    await land('2026-5');
    await land('2026-6');
    await scrollBy(0);
    await land('2026-7');
    expect(rowTop()).toBe(PLACE);
  });

  it('a row that only exists once its month has loaded is reached when it appears', async () => {
    const { view, rowTop, land } = await open({ rowBeforeData: false });
    expect(view.container.querySelector('[data-row]')).toBeNull();
    await land('2026-5');
    await land('2026-6');
    await land('2026-7');
    expect(rowTop()).toBe(PLACE);
  });

  it('a scroll that moves the row releases it: a later load no longer brings the view back', async () => {
    const { rowTop, land, scrollBy } = await open();
    await land('2026-7');
    await land('2026-5');
    await land('2026-6');
    expect(rowTop()).toBe(PLACE);
    await scrollBy(300);
    expect(rowTop()).toBe(PLACE - 300);
    await land('2026-8');
    expect(rowTop()).toBe(PLACE - 300);
  });

  it('« Aujourd\'hui » after a release puts the row back under the header', async () => {
    const { rowTop, land, scrollBy } = await open();
    await land('2026-5');
    await land('2026-6');
    await land('2026-7');
    await scrollBy(300);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Aujourd'hui" })); });
    expect(rowTop()).toBe(PLACE);
  });

  it('today\'s month loaded without the row: the scroller stops waiting, a row drawn later does not pull the view', async () => {
    const pending = {};
    const loadMonth = vi.fn((y, m) => new Promise((resolve) => { pending[`${y}-${m}`] = resolve; }));
    const view = render(<Harness loadMonth={loadMonth} rowBeforeData={false} rowAfterData={false} />);
    scroller = view.container.querySelector('[data-month-anchor]').parentElement.parentElement;
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
    await act(async () => { pending['2026-5']({}); });
    await act(async () => { pending['2026-6']({}); });
    expect(view.container.querySelector('[data-row]')).toBeNull();
    view.rerender(<Harness loadMonth={loadMonth} rowBeforeData={false} rowAfterData />);
    await act(async () => { pending['2026-7']({}); });
    const row = view.container.querySelector('[data-row]');
    expect(row).not.toBeNull();
    expect(row.getBoundingClientRect().top).not.toBe(PLACE);
  });
});
