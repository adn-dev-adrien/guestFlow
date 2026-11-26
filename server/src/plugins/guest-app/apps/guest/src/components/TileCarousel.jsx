/**
 * TileCarousel — the home's tiles as one endless, swipeable row (specs/guest-app/guest-app-local-amenities.md
 * rules 20-22), used when there are more than six tiles on a phone. Presentation only: the tiles, their labels
 * and their actions come from the caller.
 *
 * The list is drawn five times; the browser's own scrolling (snap on a tile, momentum) moves the row, and once
 * it has settled (finger up, no scroll for a moment) outside the middle copy by more than half a copy, the row
 * jumps by whole copies, which looks the same. Nothing moves on its own, and never while a finger is down. On
 * arrival the second tile of the middle copy is centred, so the first tile is the first whole one and a part of
 * its neighbours shows on both edges. Only the middle copy is reachable for assistive technology; the four
 * others are `aria-hidden` and out of the tab order but stay tappable. A tile that takes the focus is scrolled
 * into view.
 *
 * Props: `items` (array of tiles, each with a unique `key`), `renderItem(item, copyProps)` — spread `copyProps`
 * on the tile element (`aria-hidden`, `tabIndex` on the repeats).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n';

export const COPIES = [0, 1, 2, 3, 4];
const MIDDLE = 2;
export const VISIBLE_COLUMNS = 3.6;
const CLONE_PROPS = { 'aria-hidden': 'true', tabIndex: -1 };
const SETTLE_MS = 120;

/** Whole and partial tiles seen when the row is centred on a tile and `columns` tiles fit its width. */
export function visibleTiles(columns) {
  const side = (columns - 1) / 2;
  const whole = 1 + 2 * Math.floor(side);
  return { whole, partial: side > Math.floor(side) ? 2 : 0 };
}

export default function TileCarousel({ items, renderItem }) {
  const t = useT();
  const rowRef = useRef(null);
  const logical = useRef(1);
  const count = items.length;
  const keys = items.map((item) => item.key).join('|');

  const tileAt = useCallback((index) => rowRef.current && rowRef.current.children[index], []);

  // Position of a tile's left edge inside the row's scrollable content, fractional widths included.
  const leftOf = useCallback((tile) => {
    const row = rowRef.current;
    return tile.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
  }, []);

  // Centre of the snap port: the row's own padding keeps tiles clear of a landscape notch.
  const portCenter = useCallback(() => {
    const row = rowRef.current;
    const style = window.getComputedStyle(row);
    const start = parseFloat(style.paddingLeft) || 0;
    const end = parseFloat(style.paddingRight) || 0;
    return start + (row.clientWidth - start - end) / 2;
  }, []);

  const centerOn = useCallback((index) => {
    const row = rowRef.current;
    const tile = tileAt(MIDDLE * count + index);
    if (!row || !tile) return;
    row.scrollLeft = leftOf(tile) + tile.getBoundingClientRect().width / 2 - portCenter();
  }, [count, tileAt, leftOf, portCenter]);

  // Re-centre the remembered tile whenever the list changes.
  useLayoutEffect(() => {
    logical.current = Math.min(logical.current, count - 1);
    centerOn(logical.current);
  }, [keys, count, centerOn]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    let timer = null;
    let touching = false;

    const settle = () => {
      if (touching) return;
      const first = tileAt(0);
      const second = tileAt(count);
      const middle = tileAt(MIDDLE * count);
      if (!first || !second || !middle) return;
      const period = leftOf(second) - leftOf(first);
      const start = leftOf(middle);
      const mid = row.scrollLeft + portCenter();
      if (mid < start - period / 2 || mid >= start + 1.5 * period) {
        row.scrollLeft -= Math.round((mid - (start + period / 2)) / period) * period;
      }
      const center = row.scrollLeft + portCenter();
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < count; i += 1) {
        const tile = tileAt(MIDDLE * count + i);
        const distance = Math.abs(leftOf(tile) + tile.getBoundingClientRect().width / 2 - center);
        if (distance < bestDistance) { best = i; bestDistance = distance; }
      }
      logical.current = best;
    };

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    const supportsScrollEnd = 'onscrollend' in window;
    const scrollEvent = supportsScrollEnd ? 'scrollend' : 'scroll';
    const onScroll = supportsScrollEnd ? settle : arm;
    row.addEventListener(scrollEvent, onScroll);

    const onTouchStart = () => { touching = true; window.clearTimeout(timer); };
    const onTouchEnd = () => { touching = false; arm(); };
    row.addEventListener('touchstart', onTouchStart, { passive: true });
    row.addEventListener('touchend', onTouchEnd, { passive: true });
    row.addEventListener('touchcancel', onTouchEnd, { passive: true });

    const onFocusIn = (event) => {
      const tile = event.target.closest && event.target.closest('.tile');
      if (tile && tile.scrollIntoView) tile.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    };
    row.addEventListener('focusin', onFocusIn);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      let width = null;
      observer = new ResizeObserver((entries) => {
        const next = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : null;
        const changed = width !== null && next !== width;
        width = next;
        if (changed) centerOn(logical.current);
      });
      observer.observe(row);
    }
    return () => {
      window.clearTimeout(timer);
      row.removeEventListener(scrollEvent, onScroll);
      row.removeEventListener('touchstart', onTouchStart);
      row.removeEventListener('touchend', onTouchEnd);
      row.removeEventListener('touchcancel', onTouchEnd);
      row.removeEventListener('focusin', onFocusIn);
      if (observer) observer.disconnect();
    };
  }, [count, tileAt, leftOf, portCenter, centerOn]);

  return (
    <div
      ref={rowRef}
      className={`tiles loop n${count}`}
      role="group"
      aria-label={t('tile.row')}
      style={{ '--visible-cols': VISIBLE_COLUMNS }}
    >
      {COPIES.map((copy) => (
        <Fragment key={copy}>
          {items.map((item) => (
            <Fragment key={item.key}>{renderItem(item, copy === MIDDLE ? {} : CLONE_PROPS)}</Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
