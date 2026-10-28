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
 *                                     `smooth` is instant under prefers-reduced-motion. A smooth scroll that
 *                                     ends off target (content changed on the way) is corrected once it rests
 *   pinAnchor(key)                    scrollToAnchor(key), then keep the item at the top offset while the feed's
 *                                     height changes (cards that render late above it) until the operator
 *                                     scrolls, touches or types
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const DEFAULT_THRESHOLD_PX = 800;
const DEFAULT_MAX_CHAIN = 4;
const SETTLE_MS = 150;
const UP_KEYS = new Set(['PageUp', 'Home', 'ArrowUp']);
// Keys typed into a field, a select or a dialog belong to it, not to the scroller.
const typesInto = (node) => Boolean(node && node.closest
  && node.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]'));
const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ']);

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
  // The edge the current gesture is extending: a gesture never chains into the opposite edge.
  const chainEdgeRef = useRef(null);
  // Which way the operator is going ('start' | 'end'): only that edge is extended, so scrolling down
  // through folded (short) content never reaches back for the window just released above.
  const directionRef = useRef(null);
  const lastTopRef = useRef(null);
  // The last request of the gesture and how far its edge was: a load that did not push the edge farther
  // away (an empty window folded into what is drawn) ends the chain, so a short feed cannot load without end.
  const lastAskRef = useRef(null);
  // Where the scroller is after the hook's own moves and after each commit (the browser clamps it when
  // the feed shrinks): the scroll event that follows is not a gesture and must not restart the chain.
  const ownScrollRef = useRef(null);
  // The last position the hook itself set, for the pin.
  const lastSetRef = useRef(null);

  const scroller = () => latest.current.scrollerRef?.current || null;
  const topOffset = () => (latest.current.getTopOffset ? latest.current.getTopOffset() : 0);
  const anchors = () => Array.from((scroller() || document).querySelectorAll('[data-scroll-anchor]'));
  const anchorNamed = (key) => anchors().find((node) => node.getAttribute('data-scroll-anchor') === key) || null;

  const scrollTo = (top, behavior) => {
    if (behavior === 'instant') {
      ownScrollRef.current = top;
      lastSetRef.current = top;
    }
    const el = scroller();
    if (el) el.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
  };
  const scrollTop = () => (scroller() ? scroller().scrollTop : window.scrollY);

  const holdAnchor = useCallback(() => {
    const first = anchors().find((node) => node.getBoundingClientRect().bottom > topOffset() + 1);
    heldAnchorRef.current = first
      ? { key: first.getAttribute('data-scroll-anchor'), top: first.getBoundingClientRect().top, scrollTop: scrollTop() }
      : null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Operator input ends whatever the hook is still doing on their behalf (pin, settle).
  const watchInput = (cancel) => {
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach((name) => window.addEventListener(name, cancel, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, cancel));
  };

  const settleRef = useRef(null);
  const stopSettle = useCallback(() => {
    if (!settleRef.current) return;
    settleRef.current();
    settleRef.current = null;
  }, []);

  const scrollToAnchor = useCallback((key, { behavior = 'auto' } = {}) => {
    const node = anchorNamed(key);
    if (!node) return false;
    const offset = scroller() ? scroller().getBoundingClientRect().top + topOffset() : topOffset();
    const top = Math.max(0, scrollTop() + node.getBoundingClientRect().top - offset);
    stopSettle();
    if (behavior !== 'smooth' || reducedMotion()) {
      scrollTo(top, 'instant');
      return true;
    }
    scrollTo(top, 'smooth');
    // Windows may be added or released while the smooth scroll runs, which cancels it or shifts its
    // target: once it rests, an instant correction puts the item where it was asked to go.
    const target = scroller() || window;
    let timer = null;
    const finish = () => {
      stopSettle();
      const landed = anchorNamed(key);
      if (!landed) return;
      const wanted = scroller() ? scroller().getBoundingClientRect().top + topOffset() : topOffset();
      if (Math.abs(landed.getBoundingClientRect().top - wanted) >= 1) scrollToAnchor(key);
    };
    const rest = () => { clearTimeout(timer); timer = setTimeout(finish, SETTLE_MS); };
    target.addEventListener('scroll', rest, { passive: true });
    const unwatch = watchInput(() => stopSettle());
    settleRef.current = () => { clearTimeout(timer); target.removeEventListener('scroll', rest); unwatch(); };
    rest();
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
    const height = () => (scroller() ? scroller().scrollHeight : document.documentElement.scrollHeight);
    let seenHeight = height();
    const observer = list && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { seenHeight = height(); scrollToAnchor(key); })
      : null;
    if (observer) observer.observe(list);
    // A scroll the hook did not make, with the feed's height unchanged, is the operator's (a scrollbar
    // drag fires no pointer or wheel event): the pin ends.
    const target = scroller() || window;
    const onScroll = () => {
      if (height() !== seenHeight) return;
      if (lastSetRef.current === null || Math.abs(scrollTop() - lastSetRef.current) >= 1) releasePin();
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    const unwatch = watchInput(releasePin);
    pinRef.current = {
      stop: () => {
        if (observer) observer.disconnect();
        target.removeEventListener('scroll', onScroll);
        unwatch();
      },
    };
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { releasePin(); stopSettle(); }, [releasePin, stopSettle]);

  // Asks for content at the nearer edge first; an edge that has nothing to give leaves the other one,
  // unless the gesture already extends one (rule: never into the opposite edge from one gesture).
  const extend = useCallback(() => {
    const el = scroller();
    const top = scrollTop();
    const bottom = (el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight) - top;
    const { threshold: limit, onNearStart: start, onNearEnd: end } = latest.current;
    const near = [];
    if (top < limit && start) near.push({ edge: 'start', distance: top, ask: start });
    if (bottom < limit && end) near.push({ edge: 'end', distance: bottom, ask: end });
    near.sort((a, b) => a.distance - b.distance);
    let busy = false;
    for (const { edge, distance, ask } of near) {
      if (chainEdgeRef.current && chainEdgeRef.current !== edge) continue;
      if (directionRef.current && directionRef.current !== edge) continue;
      const last = lastAskRef.current;
      if (last && last.edge === edge && distance <= last.distance + 1) continue;
      const answer = ask();
      if (answer === 'started') {
        chainEdgeRef.current = edge;
        lastAskRef.current = { edge, distance };
        return 'started';
      }
      if (answer === 'pending') busy = true;
    }
    return busy ? 'pending' : 'none';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One operator gesture: the chain starts again, on whichever edge is near.
  const kick = useCallback(() => {
    chainEdgeRef.current = null;
    lastAskRef.current = null;
    const answer = extend();
    chainCountRef.current = answer === 'started' ? 1 : 0;
    chainingRef.current = answer !== 'none';
  }, [extend]);

  // A burst of input (a trackpad flick fires dozens of wheel events) is ONE gesture: the chain is reset
  // only once the operator has been quiet for SETTLE_MS, or when they turn around.
  const gestureTimerRef = useRef(null);
  const gestureActiveRef = useRef(false);
  const gesture = useCallback((direction) => {
    clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => { gestureActiveRef.current = false; }, SETTLE_MS);
    const turned = direction && direction !== directionRef.current;
    if (direction) directionRef.current = direction;
    if (gestureActiveRef.current && !turned) return;
    gestureActiveRef.current = true;
    kick();
  }, [kick]);

  useEffect(() => {
    if (!enabled) return undefined;
    const target = scrollerRef?.current || window;
    const onScroll = () => {
      const own = ownScrollRef.current;
      const now = scrollTop();
      const before = lastTopRef.current;
      ownScrollRef.current = null;
      lastTopRef.current = now;
      if (own !== null && Math.abs(now - own) < 1) return;
      gesture(before !== null && Math.abs(now - before) >= 1 ? (now < before ? 'start' : 'end') : null);
    };
    // Wheel, touch and the scrolling keys are gestures even when the page cannot move (a short feed
    // fires no scroll event at all). Typing in a field or a dialog is not one.
    let touchY = null;
    const onInput = (event) => {
      if (event.type === 'wheel') {
        if (event.deltaY) gesture(event.deltaY < 0 ? 'start' : 'end');
      } else if (event.type === 'keydown') {
        if (event.defaultPrevented || !SCROLL_KEYS.has(event.key) || typesInto(event.target)) return;
        gesture(UP_KEYS.has(event.key) ? 'start' : 'end');
      } else if (event.type === 'touchstart') {
        touchY = event.touches?.[0]?.clientY ?? null;
      } else if (event.type === 'touchmove') {
        const y = event.touches?.[0]?.clientY;
        if (touchY !== null && y !== undefined && y !== touchY) gesture(y > touchY ? 'start' : 'end');
        touchY = y ?? touchY;
      }
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    const inputs = ['wheel', 'touchstart', 'touchmove', 'keydown'];
    inputs.forEach((name) => window.addEventListener(name, onInput, { passive: true }));
    lastTopRef.current = scrollTop();
    kick();
    return () => {
      clearTimeout(gestureTimerRef.current);
      gestureActiveRef.current = false;
      target.removeEventListener('scroll', onScroll);
      inputs.forEach((name) => window.removeEventListener(name, onInput));
    };
  }, [enabled, scrollerRef, kick, gesture]);

  // After the feed commits: restore the held anchor, then carry on while the new content leaves the
  // scroller within the threshold (bounded, so an empty feed cannot loop).
  useLayoutEffect(() => {
    const held = heldAnchorRef.current;
    if (held) {
      heldAnchorRef.current = null;
      const node = anchorNamed(held.key);
      // The operator may have scrolled between the hold and this commit (a wheel handler asks for content
      // before the browser applies the scroll): their move is theirs, only the content's shift is undone.
      const delta = node ? node.getBoundingClientRect().top - (held.top - (scrollTop() - held.scrollTop)) : 0;
      if (Math.abs(delta) >= 1) scrollTo(scrollTop() + delta, 'instant');
    }
    if (latest.current.enabled && chainingRef.current) {
      if (chainCountRef.current >= latest.current.maxChain) {
        chainingRef.current = false;
      } else {
        const answer = extend();
        if (answer === 'started') chainCountRef.current += 1;
        else if (answer === 'none') chainingRef.current = false;
      }
    }
    ownScrollRef.current = scrollTop();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { holdAnchor, scrollToAnchor, pinAnchor };
}
