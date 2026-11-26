// specs/guest-app/guest-app-local-amenities.md rule 19 (up to six tiles: the grid), rule 20 (more than six under 900 px:
// one endless row, moved by the guest only), rule 21 (both sides show on arrival), rule 22 (one stop per module for
// assistive technology), rule 23 (from 900 px: one line).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TileCarousel from '../components/TileCarousel';
import { ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';

const TILE = 100;
const GAP = 10;
const VIEW = 360;
const keys = (n) => Array.from({ length: n }, (_, i) => ({ key: `t${i}`, label: `Tile ${i}` }));

// jsdom lays nothing out: the row is 360 px wide and the tiles 100 px, 10 px apart, in document order.
function mockLayout() {
  const index = (el) => [...el.parentElement.children].indexOf(el);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function offsetLeft() {
    return this.classList.contains('tile') ? index(this) * (TILE + GAP) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidth() {
    return this.classList.contains('tile') ? TILE : VIEW;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEW);
}

const renderRow = (n) => render(
  <TileCarousel items={keys(n)} renderItem={(item, copyProps) => <button type="button" className="tile" {...copyProps}>{item.label}</button>} />,
);

describe('TileCarousel — the endless row', () => {
  beforeEach(mockLayout);
  afterEach(() => vi.useRealTimers());

  it('rule 20: draws the list three times in one scrolling row', () => {
    renderRow(7);
    const row = document.querySelector('.tiles.loop');
    expect(row.children).toHaveLength(21);
    expect([...row.children].slice(7, 14).map((t) => t.textContent)).toEqual(keys(7).map((k) => k.label));
  });

  it('rule 22: the repeats are hidden, unfocusable and inert; each module is reached once', () => {
    renderRow(7);
    const tiles = [...document.querySelectorAll('.tiles.loop .tile')];
    tiles.forEach((tile, i) => {
      const middle = i >= 7 && i < 14;
      expect(tile.hasAttribute('aria-hidden')).toBe(!middle);
      expect(tile.hasAttribute('inert')).toBe(!middle);
      expect(tile.tabIndex).toBe(middle ? 0 : -1);
    });
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: 'Tile 3' })).toHaveLength(1);
  });

  it('rule 21: on arrival the 2nd tile of the middle copy is centred, so the 1st is the first whole tile', () => {
    renderRow(7);
    const second = 8 * (TILE + GAP);
    expect(document.querySelector('.tiles.loop').scrollLeft).toBe(second + TILE / 2 - VIEW / 2);
  });

  const settleScenario = (settle) => {
    const row = document.querySelector('.tiles.loop');
    const period = 7 * (TILE + GAP);
    const start = row.scrollLeft;
    const scrollTo = (left) => { row.scrollLeft = left; fireEvent.scroll(row); };

    scrollTo(30);
    act(() => { vi.advanceTimersByTime(60); });
    expect(row.scrollLeft).toBe(30);
    settle(row);
    expect(row.scrollLeft).toBe(30 + period);

    scrollTo(2 * period + 40);
    settle(row);
    expect(row.scrollLeft).toBe(period + 40);

    scrollTo(start + 20);
    settle(row);
    expect(row.scrollLeft).toBe(start + 20);
  };

  it('rule 20: once `scrollend` fires outside the middle copy the row jumps by one copy; nothing moves meanwhile', () => {
    vi.useFakeTimers();
    renderRow(7);
    settleScenario((row) => act(() => { row.dispatchEvent(new Event('scrollend')); }));
  });

  it('rule 20: without `scrollend`, the jump comes 120 ms after the last scroll event', () => {
    vi.useFakeTimers();
    const proto = Object.getPrototypeOf(window);
    const restore = [];
    [window, proto, Object.getPrototypeOf(proto)].forEach((o) => {
      if (o && Object.getOwnPropertyDescriptor(o, 'onscrollend')) {
        restore.push([o, Object.getOwnPropertyDescriptor(o, 'onscrollend')]);
        delete o.onscrollend;
      }
    });
    expect('onscrollend' in window).toBe(false);
    renderRow(7);
    settleScenario(() => act(() => { vi.advanceTimersByTime(130); }));
    restore.forEach(([o, d]) => Object.defineProperty(o, 'onscrollend', d));
  });

  it('rule 22: a tile that takes the focus is scrolled into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderRow(7);
    screen.getByRole('button', { name: 'Tile 4' }).focus();
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'center', block: 'nearest' });
    delete Element.prototype.scrollIntoView;
  });
});

const sevenTiles = (n) => ['gate', 'wifi', 'shop', 'booklet', 'places', 'contacts', 'home', 'bath', 'soliomap'].slice(0, n)
  .map((key, order) => ({ key, label: key === 'places' ? 'Alentours' : `M ${key}`, order }));
const setWidth = (wide) => {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('900') ? wide : false, media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
};

describe('home — more than six tiles', () => {
  afterEach(() => { delete window.matchMedia; });

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
    expect(document.querySelectorAll('.tiles.loop .tile')).toHaveLength(21);
    expect(document.querySelectorAll('.tiles.loop .tile[aria-hidden="true"]')).toHaveLength(14);
    expect(screen.getAllByRole('button', { name: 'Alentours' })).toHaveLength(1);
  });

  it('rule 23: from 900 px, one line with as many columns as tiles and no carousel', async () => {
    setWidth(true);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, tiles: sevenTiles(7) } }));
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.tiles.many')).not.toBeNull());
    const row = document.querySelector('.tiles.many');
    expect(row.style.getPropertyValue('--n')).toBe('7');
    expect(row.querySelectorAll('.tile')).toHaveLength(7);
    expect(document.querySelector('.tiles.loop')).toBeNull();
  });
});
