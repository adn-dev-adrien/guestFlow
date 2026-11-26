// specs/guest-app/guest-app-local-amenities.md rule 19 (up to six tiles: the grid), rule 20 (more than six under 900 px:
// one endless row, moved by the guest only), rule 21 (both sides show on arrival), rule 22 (one stop per module for
// assistive technology, the repeats stay tappable), rule 23 (900-1199 px: two lines, from 1200 px: one line).
import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TileCarousel, { VISIBLE_COLUMNS, visibleTiles } from '../components/TileCarousel';
import { ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';

const CSS = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
const cssFor = (selector) => [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]).join(';');

const TILE = 100;
const STEP = 110;
const COPIES = 5;
const keys = (n) => Array.from({ length: n }, (_, i) => ({ key: `t${i}`, label: `Tile ${i}` }));
let view = 360;

// jsdom lays nothing out: tiles are 100 px, 110 px apart, in document order, shifted by the row's scroll.
function mockLayout() {
  view = 360;
  const index = (el) => [...el.parentElement.children].indexOf(el);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.classList.contains('tile')) {
      const left = index(this) * STEP - this.parentElement.scrollLeft;
      return { left, width: TILE, right: left + TILE, top: 0, bottom: TILE, height: TILE };
    }
    return { left: 0, width: view, right: view, top: 0, bottom: TILE, height: TILE };
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => view);
}

const Tile = ({ item, copyProps, onClick }) => (
  <button type="button" className="tile" onClick={onClick} {...copyProps}>{item.label}</button>
);
const renderRow = (n, onClick) => render(
  <TileCarousel items={keys(n)} renderItem={(item, copyProps) => <Tile item={item} copyProps={copyProps} onClick={() => onClick && onClick(item.key)} />} />,
);
const rowEl = () => document.querySelector('.tiles.loop');

describe('TileCarousel — the endless row', () => {
  beforeEach(mockLayout);
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });

  it('rule 20: draws the list five times in one scrolling row, labelled for assistive technology', () => {
    renderRow(7);
    const row = rowEl();
    expect(row.children).toHaveLength(7 * COPIES);
    expect([...row.children].slice(14, 21).map((t) => t.textContent)).toEqual(keys(7).map((k) => k.label));
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBeTruthy();
  });

  it('rule 22: the four repeats are hidden and out of the tab order; each module is reached once', () => {
    renderRow(7);
    [...document.querySelectorAll('.tiles.loop .tile')].forEach((tile, i) => {
      const middle = i >= 14 && i < 21;
      expect(tile.hasAttribute('aria-hidden')).toBe(!middle);
      expect(tile.hasAttribute('inert')).toBe(false);
      expect(tile.tabIndex).toBe(middle ? 0 : -1);
    });
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: 'Tile 3' })).toHaveLength(1);
  });

  it('rule 22: tapping a repeated tile does what the real one does', () => {
    const onClick = vi.fn();
    renderRow(7, onClick);
    const tiles = [...document.querySelectorAll('.tiles.loop .tile')];
    fireEvent.click(tiles[3]);
    fireEvent.click(tiles[7 * 4 + 3]);
    fireEvent.click(tiles[7 * 2 + 3]);
    expect(onClick.mock.calls).toEqual([['t3'], ['t3'], ['t3']]);
  });

  it('rule 21: on arrival the 2nd tile of the middle copy is centred, so the 1st is the first whole tile', () => {
    renderRow(7);
    expect(rowEl().scrollLeft).toBe(15 * STEP + TILE / 2 - view / 2);
  });

  it('rule 21: the column formula shows three whole tiles and two partial ones', () => {
    expect(visibleTiles(VISIBLE_COLUMNS)).toEqual({ whole: 3, partial: 2 });
    renderRow(7);
    expect(rowEl().style.getPropertyValue('--visible-cols')).toBe(String(VISIBLE_COLUMNS));
    expect(cssFor('.app:not(.desk) .tiles.loop')).toMatch(/grid-auto-columns:\s*calc\(\(100% - 3 \* 9px\) \/ var\(--visible-cols/);
  });

  it('rule 20: the row keeps the notch clear in landscape', () => {
    const rules = cssFor('.app:not(.desk) .tiles.loop');
    expect(rules).toMatch(/padding:[^;]*env\(safe-area-inset-right\)[^;]*env\(safe-area-inset-left\)/);
    expect(rules).toMatch(/scroll-padding-inline:\s*env\(safe-area-inset-left\)\s*env\(safe-area-inset-right\)/);
  });

  const P = 7 * STEP;
  const settleScenario = (settle) => {
    const row = rowEl();
    const start = row.scrollLeft;
    const scrollTo = (left) => { row.scrollLeft = left; fireEvent.scroll(row); };

    scrollTo(30);
    act(() => { vi.advanceTimersByTime(60); });
    expect(row.scrollLeft).toBe(30);
    settle(row);
    expect(row.scrollLeft).toBe(30 + 2 * P);

    scrollTo(4 * P + 40);
    settle(row);
    expect(row.scrollLeft).toBe(2 * P + 40);

    scrollTo(start + 20);
    settle(row);
    expect(row.scrollLeft).toBe(start + 20);

    // Less than half a copy past the middle copy: still the same picture, nothing moves.
    scrollTo(start - 250);
    settle(row);
    expect(row.scrollLeft).toBe(start - 250);
  };

  it('rule 20: once `scrollend` fires outside the middle copy the row jumps by whole copies; nothing moves meanwhile', () => {
    vi.useFakeTimers();
    renderRow(7);
    settleScenario(() => act(() => { rowEl().dispatchEvent(new Event('scrollend')); }));
  });

  it('rule 20: without `scrollend`, the jump comes 120 ms after the last scroll event', () => {
    vi.useFakeTimers();
    const proto = Object.getPrototypeOf(window);
    const restore = [];
    try {
      [window, proto, Object.getPrototypeOf(proto)].forEach((o) => {
        if (o && Object.getOwnPropertyDescriptor(o, 'onscrollend')) {
          restore.push([o, Object.getOwnPropertyDescriptor(o, 'onscrollend')]);
          delete o.onscrollend;
        }
      });
      expect('onscrollend' in window).toBe(false);
      renderRow(7);
      settleScenario(() => act(() => { vi.advanceTimersByTime(130); }));
    } finally {
      restore.forEach(([o, d]) => Object.defineProperty(o, 'onscrollend', d));
    }
  });

  it('rule 20: a hard fling past two copies is brought back whole copies at a time', () => {
    vi.useFakeTimers();
    renderRow(7);
    const row = rowEl();
    row.scrollLeft = 20;
    act(() => { row.dispatchEvent(new Event('scrollend')); });
    expect(row.scrollLeft).toBe(20 + 2 * P);
  });

  it('rule 20: never re-centres while a finger is down; restarts the wait when it lifts', () => {
    vi.useFakeTimers();
    const proto = Object.getPrototypeOf(window);
    const restore = [];
    try {
      [window, proto, Object.getPrototypeOf(proto)].forEach((o) => {
        if (o && Object.getOwnPropertyDescriptor(o, 'onscrollend')) {
          restore.push([o, Object.getOwnPropertyDescriptor(o, 'onscrollend')]);
          delete o.onscrollend;
        }
      });
      renderRow(7);
      const row = rowEl();
      fireEvent.touchStart(row);
      row.scrollLeft = 30;
      fireEvent.scroll(row);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(row.scrollLeft).toBe(30);
      fireEvent.touchEnd(row);
      act(() => { vi.advanceTimersByTime(60); });
      expect(row.scrollLeft).toBe(30);
      act(() => { vi.advanceTimersByTime(80); });
      expect(row.scrollLeft).toBe(30 + 2 * P);

      fireEvent.touchStart(row);
      row.scrollLeft = 40;
      fireEvent.scroll(row);
      fireEvent.touchCancel(row);
      act(() => { vi.advanceTimersByTime(130); });
      expect(row.scrollLeft).toBe(40 + 2 * P);
    } finally {
      restore.forEach(([o, d]) => Object.defineProperty(o, 'onscrollend', d));
    }
  });

  it('rule 21: `scrollend` during a touch is ignored', () => {
    vi.useFakeTimers();
    renderRow(7);
    const row = rowEl();
    fireEvent.touchStart(row);
    row.scrollLeft = 30;
    act(() => { row.dispatchEvent(new Event('scrollend')); });
    expect(row.scrollLeft).toBe(30);
  });

  it('rule 21: a new list re-centres the remembered tile', () => {
    const renderItem = (item, copyProps) => <Tile item={item} copyProps={copyProps} />;
    const { rerender } = render(<TileCarousel items={keys(7)} renderItem={renderItem} />);
    rerender(<TileCarousel items={keys(8)} renderItem={renderItem} />);
    expect(rowEl().children).toHaveLength(8 * COPIES);
    expect(rowEl().scrollLeft).toBe((16 + 1) * STEP + TILE / 2 - view / 2);
  });

  it('rule 21: re-centres when the width changes, not when only the height does', () => {
    let notify;
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { notify = cb; } observe() {} disconnect() {} });
    try {
      renderRow(7);
      const row = rowEl();
      const entry = (width, height) => [{ contentRect: { width, height } }];
      act(() => notify(entry(360, 100)));
      row.scrollLeft = 1000;
      act(() => notify(entry(360, 140)));
      expect(row.scrollLeft).toBe(1000);
      view = 300;
      act(() => notify(entry(300, 140)));
      expect(row.scrollLeft).toBe(15 * STEP + TILE / 2 - 300 / 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rule 22: a tile that takes the focus is scrolled into view by the least movement', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderRow(7);
    screen.getByRole('button', { name: 'Tile 4' }).focus();
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
  });
});

const sevenTiles = (n) => ['gate', 'wifi', 'shop', 'booklet', 'places', 'contacts', 'home', 'bath', 'soliomap'].slice(0, n)
  .map((key, order) => ({ key, label: key === 'places' ? 'Alentours' : `M ${key}`, order }));
const setWidth = (wide, desk = false) => {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('1200') ? desk : query.includes('900') ? wide : false,
    media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
};

describe('home — more than six tiles', () => {
  afterEach(() => { delete window.matchMedia; vi.restoreAllMocks(); });

  it('rule 19: up to six tiles, the grid stays', async () => {
    setWidth(false);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, tiles: sevenTiles(6) } }));
    renderApp('/');
    await waitFor(() => expect(document.querySelectorAll('.tiles .tile').length).toBeGreaterThan(0));
    expect(document.querySelector('.tiles.loop')).toBeNull();
    expect(document.querySelectorAll('.tiles .tile')).toHaveLength(6);
  });

  it('rules 20, 22: seven tiles on a phone, an endless row where each module is focusable once', async () => {
    setWidth(false);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, tiles: sevenTiles(7) } }));
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.tiles.loop')).not.toBeNull());
    expect(document.querySelectorAll('.tiles.loop .tile')).toHaveLength(35);
    expect(document.querySelectorAll('.tiles.loop .tile[aria-hidden="true"]')).toHaveLength(28);
    expect(screen.getAllByRole('button', { name: 'Alentours' })).toHaveLength(1);
  });

  it('rule 23: from 900 to 1199 px, two lines of ceil(n / 2) columns, no carousel', async () => {
    setWidth(true);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, tiles: sevenTiles(7) } }));
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.tiles.many')).not.toBeNull());
    const row = document.querySelector('.tiles.many');
    expect(row.style.getPropertyValue('--cols')).toBe('4');
    expect(row.querySelectorAll('.tile')).toHaveLength(7);
    expect(document.querySelector('.tiles.loop')).toBeNull();
    expect(cssFor('.app.wide:not(.desk) .tiles.many')).toMatch(/repeat\(var\(--cols\),\s*minmax\(0,\s*1fr\)\)/);
    expect(Number(cssFor('.app.wide:not(.desk) .tiles.many .tile').match(/min-height:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(44);
  });

  it('rule 23: from 1200 px, one line with as many columns as tiles', async () => {
    setWidth(true, true);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, tiles: sevenTiles(7) } }));
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.tiles.many')).not.toBeNull());
    const row = document.querySelector('.tiles.many');
    expect(row.style.getPropertyValue('--n')).toBe('7');
    expect(row.closest('.app').classList.contains('desk')).toBe(true);
    expect(cssFor('.app.wide.desk .tiles.many')).toMatch(/repeat\(var\(--n\),\s*minmax\(0,\s*1fr\)\)/);
    expect(document.querySelector('.tiles.loop')).toBeNull();
  });
});
