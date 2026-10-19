/**
 * useAnchorScroll — brings the element a URL hash names into view below the sticky bars, and keeps it
 * there while the page is still growing above it (sections loaded lazily, cards filled by their own
 * requests). Generic: any page whose hash targets content that appears after the first render.
 *
 *   useAnchorScroll(hash, { prefix = '#', settleMs = 1500 })
 *
 * - The element is looked for until it exists (up to `settleMs`).
 * - Its `scroll-margin-top` is the measured bottom of the sticky bars (the app bar and the page's
 *   PageActionBar), plus 8 px — never a guessed constant.
 * - Every layout change during `settleMs` (a ResizeObserver on the document) scrolls it back into
 *   place, until the user scrolls, touches, clicks or types: from then on the page is theirs.
 *
 * specs/plugins-phase-0-foundation.md rule 26.
 */
import { useEffect } from 'react';

const GAP = 8;

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

export default function useAnchorScroll(hash, { prefix = '#', settleMs = 1500 } = {}) {
  useEffect(() => {
    if (!hash || !hash.startsWith(prefix) || hash.length < 2) return undefined;
    const id = decodeURIComponent(hash.slice(1));
    let done = false;
    let observer = null;
    let seekTimer = null;

    const place = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.style.scrollMarginTop = `${Math.round(stickyBarsBottom()) + GAP}px`;
      el.scrollIntoView({ block: 'start' });
      return true;
    };

    const USER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const stop = () => {
      done = true;
      clearTimeout(seekTimer);
      if (observer) observer.disconnect();
      USER_EVENTS.forEach((type) => window.removeEventListener(type, stop, true));
    };
    USER_EVENTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));

    const started = Date.now();
    const seek = () => {
      if (done) return;
      if (place()) {
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(() => { if (!done) place(); });
          observer.observe(document.body);
        }
        return;
      }
      if (Date.now() - started < settleMs) seekTimer = setTimeout(seek, 50);
    };
    seek();
    const settle = setTimeout(stop, settleMs);
    return () => { clearTimeout(settle); stop(); };
  }, [hash, prefix, settleMs]);
}
