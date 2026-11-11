/**
 * Starts page chunks early (specs/inte-performance.md rule 10): the one the URL asks for at boot, in
 * parallel with `/auth/me`, and the main ones when the browser is idle after the first render.
 */
import { matchPath } from 'react-router';

/** Starts the import of the page whose route pattern matches `pathname`; → whether one matched. */
export function preloadRoute(routes, pathname) {
  const hit = routes.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
  if (!hit) return false;
  hit[1].preload();
  return true;
}

const hasSaveData = (nav) => Boolean(nav && nav.connection && nav.connection.saveData);

/**
 * Imports `pages` one idle slot at a time; nothing when the visitor asked to save data.
 * → a function that cancels what is still waiting.
 */
export function prefetchOnIdle(pages, { win = window, nav = typeof navigator === 'undefined' ? null : navigator } = {}) {
  if (hasSaveData(nav)) return () => {};
  const queue = [...pages];
  let handle = null;
  const hasIdle = typeof win.requestIdleCallback === 'function';
  const schedule = (work) => (hasIdle ? win.requestIdleCallback(work, { timeout: 4000 }) : win.setTimeout(work, 1500));
  const cancel = (id) => (hasIdle ? win.cancelIdleCallback(id) : win.clearTimeout(id));
  const next = () => {
    const page = queue.shift();
    if (!page) return;
    page.preload();
    handle = schedule(next);
  };
  handle = schedule(next);
  return () => { queue.length = 0; if (handle != null) cancel(handle); };
}
