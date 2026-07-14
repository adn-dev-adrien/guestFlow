import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop — resets the window scroll position on every route change.
 *
 * React Router preserves the scroll position between routes, so a page opened after scrolling deep
 * into the previous one used to appear mid-content with the sticky top bar out of view
 * (specs/design-system.md §3.6). Renders nothing; mount once inside the router.
 *
 * Hash navigations (e.g. /page#section) are left alone so in-page anchors keep working. The scroll
 * is instant (no smooth behavior) — safe for prefers-reduced-motion.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return; // anchor navigation → let the browser handle the target
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}
