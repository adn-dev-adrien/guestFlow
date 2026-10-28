/**
 * useInfiniteEdgeScroll — the scroll machinery of an ordered feed that grows at both ends
 * (specs/dashboard-planning-scroll.md rules 13, 18, 19): it notices the scroller nearing an edge, asks
 * the feed for more, keeps what the operator is looking at in place when content is added or released
 * ABOVE it, chains a bounded number of requests when the new content is short, and scrolls to a key.
 * It loads nothing and knows no item type: the feed owns its data and its in-flight state.
 *
 * Scroller: an element (`scrollerRef`) or, without one, the window.
 *
 * Items: every element of the feed that can serve as a reference carries `data-scroll-anchor="<key>"`.
 *
 * Options:
 *   scrollerRef?    React ref of the scrolling element (default: the window)
 *   enabled         boolean — nothing happens while false (e.g. before the opening position is set)
 *   version         any — must change at every commit of the feed's content: the anchor is restored and a
 *                   chained request considered after it
 *   threshold?      px from an edge under which more is asked (default 800)
 *   maxChain?       requests chained after one scroll gesture (default 4)
 *   onNearStart     () => 'started' | 'pending' | 'none' — ask for earlier content
 *   onNearEnd       () => 'started' | 'pending' | 'none' — ask for later content
 *                   'started': a request was made; 'pending': one is already in flight; 'none': nothing to ask
 *   getTopOffset?   () => px hidden under a sticky bar at the top of the scroller (default 0)
 *
 * Returns:
 *   holdAnchor()                      call right BEFORE the state change that adds or removes content above
 *                                     the viewport: the first visible item keeps its place on screen after
 *                                     the next commit
 *   scrollToAnchor(key, { behavior }) bring the item to the top offset; false when it is not drawn.
 *                                     `smooth` is instant under prefers-reduced-motion
 *   pinAnchor(key)                    scrollToAnchor(key), then keep the item at the top offset while the feed's
 *                                     height changes (cards that render late above it) until the operator
 *                                     scrolls, touches or types
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const DEFAULT_THRESHOLD_PX = 800;
const DEFAULT_MAX_CHAIN = 4;

const reducedMotion = () => typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function useInfiniteEdgeScroll({
  scrollerRef,
  enabled,
  version,
  threshold = DEFAULT_THRESHOLD_PX,
  maxChain = DEFAULT_MAX_CHAIN,
  onNearStart,
  onNearEnd,
  getTopOffset,
}) {
  const latest = useRef({});
  latest.current = { scrollerRef, enabled, threshold, maxChain, onNearStart, onNearEnd, getTopOffset };
  const heldAnchorRef = useRef(null);
  const chainingRef = useRef(false);
  const chainCountRef = useRef(0);
  // Where the hook itself last moved the scroller: the scroll event that follows is not a gesture, so it
  // must not reset the chain (a short feed would otherwise load without end through its own adjustments).
  const ownScrollRef = useRef(null);

  const scroller = () => latest.current.scrollerRef?.current || null;
  const topOffset = () => (latest.current.getTopOffset ? latest.current.getTopOffset() : 0);
  const anchors = () => Array.from((scroller() || document).querySelectorAll('[data-scroll-anchor]'));
  const anchorNamed = (key) => anchors().find((node) => node.getAttribute('data-scroll-anchor') === key) || null;

  const scrollTo = (top, behavior) => {
    if (behavior === 'instant') ownScrollRef.current = top;
    const el = scroller();
    if (el) el.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
  };
  const scrollTop = () => (scroller() ? scroller().scrollTop : window.scrollY);

  const holdAnchor = useCallback(() => {
    const first = anchors().find((node) => node.getBoundingClientRect().bottom > topOffset() + 1);
    heldAnchorRef.current = first
      ? { key: first.getAttribute('data-scroll-anchor'), top: first.getBoundingClientRect().top }
      : null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToAnchor = useCallback((key, { behavior = 'auto' } = {}) => {
    const node = anchorNamed(key);
    if (!node) return false;
    const offset = scroller() ? scroller().getBoundingClientRect().top + topOffset() : topOffset();
    const top = Math.max(0, scrollTop() + node.getBoundingClientRect().top - offset);
    scrollTo(top, behavior === 'smooth' && !reducedMotion() ? 'smooth' : 'instant');
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pinRef = useRef(null);
  const releasePin = useCallback(() => {
    if (!pinRef.current) return;
    pinRef.current.stop();
    pinRef.current = null;
  }, []);
  const pinAnchor = useCallback((key) => {
    releasePin();
    if (!scrollToAnchor(key)) return false;
    const list = anchorNamed(key)?.parentElement;
    const observer = list && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scrollToAnchor(key))
      : null;
    if (observer) observer.observe(list);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach((name) => window.addEventListener(name, releasePin, { passive: true }));
    pinRef.current = {
      stop: () => {
        if (observer) observer.disconnect();
        events.forEach((name) => window.removeEventListener(name, releasePin));
      },
    };
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => releasePin, [releasePin]);

  // Asks for content at the nearer edge first; an edge that has nothing to give leaves the other one.
  const extend = useCallback(() => {
    const el = scroller();
    const top = scrollTop();
    const bottom = (el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight) - top;
    const { threshold: limit, onNearStart: start, onNearEnd: end } = latest.current;
    const near = [];
    if (top < limit && start) near.push({ distance: top, ask: start });
    if (bottom < limit && end) near.push({ distance: bottom, ask: end });
    near.sort((a, b) => a.distance - b.distance);
    let busy = false;
    for (const { ask } of near) {
      const answer = ask();
      if (answer === 'started') return 'started';
      if (answer === 'pending') busy = true;
    }
    return busy ? 'pending' : 'none';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kick = useCallback(() => {
    const answer = extend();
    chainCountRef.current = answer === 'started' ? 1 : 0;
    chainingRef.current = answer !== 'none';
  }, [extend]);

  useEffect(() => {
    if (!enabled) return undefined;
    const target = scrollerRef?.current || window;
    const onScroll = () => {
      const own = ownScrollRef.current;
      ownScrollRef.current = null;
      if (own !== null && Math.abs(scrollTop() - own) < 1) return;
      kick();
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    kick();
    return () => target.removeEventListener('scroll', onScroll);
  }, [enabled, scrollerRef, kick]);

  // After the feed commits: restore the held anchor, then carry on while the new content leaves the
  // scroller within the threshold (bounded, so an empty feed cannot loop).
  useLayoutEffect(() => {
    const held = heldAnchorRef.current;
    if (held) {
      heldAnchorRef.current = null;
      const node = anchorNamed(held.key);
      const delta = node ? node.getBoundingClientRect().top - held.top : 0;
      if (Math.abs(delta) >= 1) scrollTo(scrollTop() + delta, 'instant');
    }
    if (!latest.current.enabled || !chainingRef.current) return;
    if (chainCountRef.current >= latest.current.maxChain) {
      chainingRef.current = false;
      return;
    }
    const answer = extend();
    if (answer === 'started') chainCountRef.current += 1;
    else if (answer === 'none') chainingRef.current = false;
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { holdAnchor, scrollToAnchor, pinAnchor };
}
