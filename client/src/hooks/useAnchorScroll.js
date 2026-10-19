/**
 * useAnchorScroll — brings the element a URL hash names into view below the sticky bars, and keeps it
 * there while the page is still growing above it (sections loaded lazily, cards filled by their own
 * requests). Generic: any page whose hash targets content that appears after the first render.
 *
 *   useAnchorScroll(hash, { prefix = '#', navigationKey, quietMs = 800, maxMs = 8000 })
 *
 * - The element is looked for until it exists (up to `maxMs`).
 * - Its `scroll-margin-top` is the measured bottom of the sticky bars (the app bar and the page's
 *   PageActionBar), plus 8 px — never a guessed constant.
 * - Every layout change scrolls it back into place. It stops `quietMs` after the LAST change, at
 *   `maxMs` at the latest, and at once when the user scrolls, drags the scrollbar, touches, clicks or
 *   types: from then on the page is theirs.
 * - Everything before the anchor is taken out of the browser's scroll anchoring (`overflow-anchor:
 *   none`), so the browser itself keeps the anchor in place when a section above it grows after the
 *   timers have stopped (a slow request). Restored when the user takes the page or it unmounts.
 * - `navigationKey` (the router location's key) runs it again when the same hash is opened twice.
 * - A malformed hash (« #plugin-%E0%A4%A ») is read as typed, never thrown.
 *
 * specs/plugins-phase-0-foundation.md rules 26, 27.
 */
import { useEffect } from 'react';

const GAP = 8;
const LAYOUT_SETTLE_MS = 150;
const USER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

/** The lowest bottom edge of the bars that stay pinned to the top of the viewport. */
export function stickyBarsBottom(doc = document) {
  const bars = [...doc.querySelectorAll('header, [data-sticky-bar]')];
  return bars.reduce((max, el) => {
    const style = doc.defaultView.getComputedStyle(el);
    if (style.position !== 'sticky' && style.position !== 'fixed') return max;
    const rect = el.getBoundingClientRect();
    // A sticky bar is measured where it will be once pinned: its `top` plus its height.
    const bottom = style.position === 'sticky' ? (parseFloat(style.top) || 0) + rect.height : rect.bottom;
    return bottom > 0 ? Math.max(max, bottom) : max;
  }, 0);
}

/** The id a hash names; a hash that does not decode is taken as typed. */
export function anchorIdOf(hash) {
  const raw = String(hash || '').slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function useAnchorScroll(hash, {
  prefix = '#', navigationKey, quietMs = 800, maxMs = 8000,
} = {}) {
  useEffect(() => {
    if (!hash || !hash.startsWith(prefix) || hash.length < 2) return undefined;
    const id = anchorIdOf(hash);
    let done = false;
    let observer = null;
    let seekTimer = null;
    let quietTimer = null;
    let capTimer = null;
    let placedY = null;
    let placedHeight = 0;
    let lastLayoutAt = 0;
    const unanchored = [];

    // The browser anchors the scroll to the first visible element: leaving out everything before the
    // target makes the target that element.
    const anchorOn = (el) => {
      if (unanchored.length) return;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (!sib.style.overflowAnchor) { sib.style.overflowAnchor = 'none'; unanchored.push(sib); }
        }
      }
    };
    const releaseAnchor = () => {
      unanchored.splice(0).forEach((sib) => { sib.style.overflowAnchor = ''; });
    };

    const place = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      anchorOn(el);
      el.style.scrollMarginTop = `${Math.round(stickyBarsBottom()) + GAP}px`;
      el.scrollIntoView({ block: 'start' });
      placedY = window.scrollY;
      placedHeight = document.documentElement.scrollHeight;
      lastLayoutAt = performance.now();
      return true;
    };

    // Telling the user's scroll from ours. Ours is set inside `place()` (placedY follows it); the
    // browser's own adjustments (scroll anchoring, a page that grew or shrank) come right after a
    // layout change: the page's height differs from when it was placed, or the observer has just
    // reported one. A scroll with neither is the user's: the wheel, the scrollbar dragged, a key held.
    const onScroll = () => {
      if (done || placedY === null) return;
      if (Math.abs(window.scrollY - placedY) <= 2) return;
      const relaid = document.documentElement.scrollHeight !== placedHeight
        || performance.now() - lastLayoutAt < LAYOUT_SETTLE_MS;
      if (relaid) { place(); return; }
      userTookOver(); // eslint-disable-line no-use-before-define
    };

    const stop = () => {
      if (done) return;
      done = true;
      clearTimeout(seekTimer);
      clearTimeout(quietTimer);
      clearTimeout(capTimer);
      if (observer) observer.disconnect();
      USER_EVENTS.forEach((type) => window.removeEventListener(type, userTookOver, true));
      window.removeEventListener('scroll', onScroll, true);
    };
    function userTookOver() {
      stop();
      releaseAnchor();
    }

    const settleLater = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(stop, quietMs);
    };

    USER_EVENTS.forEach((type) => window.addEventListener(type, userTookOver, { capture: true, passive: true }));
    capTimer = setTimeout(stop, maxMs);

    const seek = () => {
      if (done) return;
      if (!place()) { seekTimer = setTimeout(seek, 50); return; }
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      settleLater();
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => {
          if (done) return;
          lastLayoutAt = performance.now();
          place();
          settleLater();
        });
        observer.observe(document.body);
      }
    };
    seek();
    return () => { stop(); releaseAnchor(); };
  }, [hash, prefix, navigationKey, quietMs, maxMs]);
}
