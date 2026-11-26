/**
 * TileCarousel — the home's tiles as one endless, swipeable row (specs/guest-app/guest-app-local-amenities.md
 * rules 20-22), used when there are more than six tiles on a phone. Presentation only: the tiles, their labels
 * and their actions come from the caller.
 *
 * The list is drawn three times; the browser's own scrolling (snap on a tile, momentum) moves the row, and once
 * it has settled outside the middle copy the row jumps by one copy's width, which looks the same. Nothing moves
 * on its own. On arrival the second tile of the middle copy is centred, so the first tile is the first whole one
 * and a part of its neighbours shows on both edges. The two outer copies are `inert`, hidden from screen readers
 * and skipped by the keyboard (each module is reached once); a tile that takes the focus is scrolled into view.
 *
 * Props: `items` (array of tiles, each with a unique `key`), `renderItem(item, copyProps)` — spread `copyProps`
 * on the tile element (`aria-hidden`, `tabIndex`, `inert` on the repeats).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const COPIES = [0, 1, 2];
const CLONE_PROPS = { 'aria-hidden': 'true', tabIndex: -1, inert: true };
const SETTLE_MS = 120;

export default function TileCarousel({ items, renderItem }) {
  const rowRef = useRef(null);
  const logical = useRef(1);
  const count = items.length;
  const keys = items.map((item) => item.key).join('|');

  const tileAt = useCallback((index) => rowRef.current && rowRef.current.children[index], []);

  const centerOn = useCallback((index) => {
    const row = rowRef.current;
    const tile = tileAt(count + index);
    if (!row || !tile) return;
    row.scrollLeft = tile.offsetLeft + tile.offsetWidth / 2 - row.clientWidth / 2;
  }, [count, tileAt]);

  // Re-centre the remembered tile whenever the list changes.
  useLayoutEffect(() => {
    logical.current = Math.min(logical.current, count - 1);
    centerOn(logical.current);
  }, [keys, count, centerOn]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    let timer = null;

    const settle = () => {
      const first = tileAt(0);
      const second = tileAt(count);
      const third = tileAt(2 * count);
      if (!first || !second || !third) return;
      const period = second.offsetLeft - first.offsetLeft;
      const mid = row.scrollLeft + row.clientWidth / 2;
      if (mid < second.offsetLeft) row.scrollLeft += period;
      else if (mid >= third.offsetLeft) row.scrollLeft -= period;
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < count; i += 1) {
        const tile = tileAt(count + i);
        const distance = Math.abs(tile.offsetLeft + tile.offsetWidth / 2 - (row.scrollLeft + row.clientWidth / 2));
        if (distance < bestDistance) { best = i; bestDistance = distance; }
      }
      logical.current = best;
    };

    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    const supportsScrollEnd = 'onscrollend' in window;
    row.addEventListener(supportsScrollEnd ? 'scrollend' : 'scroll', supportsScrollEnd ? settle : onScroll);

    const onFocusIn = (event) => {
      const tile = event.target.closest && event.target.closest('.tile');
      if (tile && tile.scrollIntoView) tile.scrollIntoView({ inline: 'center', block: 'nearest' });
    };
    row.addEventListener('focusin', onFocusIn);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => centerOn(logical.current));
      observer.observe(row);
    }
    return () => {
      window.clearTimeout(timer);
      row.removeEventListener(supportsScrollEnd ? 'scrollend' : 'scroll', supportsScrollEnd ? settle : onScroll);
      row.removeEventListener('focusin', onFocusIn);
      if (observer) observer.disconnect();
    };
  }, [count, tileAt, centerOn]);

  return (
    <div ref={rowRef} className={`tiles loop n${count}`}>
      {COPIES.map((copy) => (
        <Fragment key={copy}>
          {items.map((item) => (
            <Fragment key={item.key}>{renderItem(item, copy === 1 ? {} : CLONE_PROPS)}</Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
