/**
 * usePlanningTimeline — the windows of the planning (specs/dashboard-planning-scroll.md rules 11, 12,
 * 19, 20, 21, 23). The timeline is made of 14-day windows on a fixed grid anchored on the server's
 * today: window k covers `[today + 14k, today + 14k + 13]`. Each window is asked once from
 * `GET /api/planning/days` together with each `planning.days` contribution's `load({ from, to })`;
 * at most 8 are kept; a failed window stays at its edge until retried.
 *
 * Options: `today` (the server's day, null while unknown), `contributions` (the `planning.days` slot),
 * `holdAnchor` (called right before a change above the viewport), `onPluginError(contribution)`,
 * `onReloadError()` (a loaded window that could not be refreshed keeps its days).
 *
 * Returns: `phase` ('idle' | 'opening' | 'ready' | 'error'), `windows` (earliest first, each
 * `{ k, from, to, status: 'loading' | 'loaded' | 'failed', days, alerts, contrib }`), `version` (changes at
 * every commit), `requestStart()` / `requestEnd()` ('started' | 'pending' | 'none'), `retry(k)`,
 * `reopen()`, `reloadWindowsHolding(reservationId)`, `reloadContributions(contributions)`,
 * `mapDays(fn)` (optimistic edits of the drawn days).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';
import { addIsoDays } from '../utils/isoDay';

export const WINDOW_DAYS = 14;
export const MAX_WINDOWS = 8;
const OPENING_WINDOWS = [-1, 0, 1];

export const contributionId = (c) => `${c.pluginId}:${c.key}`;

const rangeOf = (today, k) => ({
  from: addIsoDays(today, k * WINDOW_DAYS),
  to: addIsoDays(today, k * WINDOW_DAYS + WINDOW_DAYS - 1),
});

const emptyStore = (gen) => ({ gen, phase: 'idle', windows: {} });

// Keeps at most MAX_WINDOWS windows that are loaded or loading: the loaded one farthest from `near` is
// released first. An in-flight placeholder is never evicted — its answer would be dropped and asked again.
function evictFarthest(windows, near) {
  const kept = { ...windows };
  const count = () => Object.values(kept).filter((w) => w.status !== 'failed').length;
  while (count() > MAX_WINDOWS) {
    const loaded = Object.values(kept).filter((w) => w.status === 'loaded' && w.k !== near);
    if (!loaded.length) break;
    const farthest = loaded.reduce((a, b) => (Math.abs(b.k - near) > Math.abs(a.k - near) ? b : a));
    delete kept[farthest.k];
    // A failed edge beyond the released window would be left detached from the others.
    Object.values(kept).forEach((w) => {
      if (w.status === 'failed' && Math.sign(w.k - near) === Math.sign(farthest.k - near) && Math.abs(w.k - near) > Math.abs(farthest.k - near)) delete kept[w.k];
    });
  }
  return kept;
}

function bounds(windows) {
  const ks = Object.keys(windows).map(Number);
  return { lo: Math.min(...ks), hi: Math.max(...ks) };
}

export default function usePlanningTimeline({
  today, contributions, holdAnchor, onPluginError, onReloadError,
}) {
  // The truth lives in a ref so that two requests made in the same tick (a scroll burst, a chained
  // edge) see each other; the state only re-renders.
  const store = useRef(emptyStore(0));
  const [snapshot, setSnapshot] = useState(store.current);
  // The request each window is waiting for: an answer to an older one (released, rebuilt, asked again) is dropped.
  const tokens = useRef({});
  const latest = useRef({});
  latest.current = { today, contributions, holdAnchor, onPluginError, onReloadError };

  const commit = useCallback((change, { anchor = false } = {}) => {
    const next = change(store.current);
    if (next === store.current) return;
    if (anchor) latest.current.holdAnchor?.();
    store.current = next;
    setSnapshot(next);
  }, []);

  const loadContributions = useCallback((list, range) => Promise.all(list.map((c) => Promise.resolve()
    .then(() => c.load(range))
    .then((byDate) => [contributionId(c), byDate || {}])
    .catch(() => {
      latest.current.onPluginError?.(c);
      return null;
    }))), []);

  // Asks window k and writes the answer, unless the grid was rebuilt or the window released since.
  // `placeholder` shows the window as loading at its edge; a refresh keeps the days until the new ones land.
  const fetchWindow = useCallback(async (k, { contributionsOnly = null } = {}) => {
    const { gen } = store.current;
    const token = Symbol('window');
    if (!contributionsOnly) tokens.current[k] = token;
    const { from, to } = rangeOf(latest.current.today, k);
    const current = () => (store.current.gen === gen ? store.current.windows[k] : undefined);
    const list = contributionsOnly || latest.current.contributions;
    const refresh = !contributionsOnly && store.current.windows[k]?.status === 'loaded';
    const [days, loaded] = await Promise.all([
      contributionsOnly ? Promise.resolve(null) : api.getPlanningDays({ from, to }).catch(() => undefined),
      loadContributions(list, { from, to }),
    ]);
    const target = current();
    if (!target || (contributionsOnly ? target.status !== 'loaded' : tokens.current[k] !== token)) return;
    if (days === undefined && refresh) {
      latest.current.onReloadError?.();
      return;
    }
    if (days === undefined) {
      commit((s) => ({ ...s, windows: { ...s.windows, [k]: { ...target, status: 'failed' } } }));
      return;
    }
    const contrib = contributionsOnly ? { ...target.contrib } : {};
    loaded.filter(Boolean).forEach(([id, byDate]) => { contrib[id] = byDate; });
    commit((s) => ({
      ...s,
      windows: evictFarthest({
        ...s.windows,
        [k]: {
          ...target,
          status: 'loaded',
          days: days ? days.days : target.days,
          alerts: days ? days.alerts : target.alerts,
          contrib,
        },
      }, k),
    }), { anchor: true });
  }, [commit, loadContributions]);

  const placeholder = (k, today0) => ({
    k, ...rangeOf(today0, k), status: 'loading', days: [], alerts: { arrivals: {}, departures: {} }, contrib: {},
  });

  const open = useCallback(() => {
    const gen = store.current.gen + 1;
    tokens.current = {};
    const day = latest.current.today;
    store.current = {
      gen,
      phase: 'opening',
      windows: Object.fromEntries(OPENING_WINDOWS.map((k) => [k, placeholder(k, day)])),
    };
    setSnapshot(store.current);
    Promise.all(OPENING_WINDOWS.map((k) => fetchWindow(k))).then(() => {
      if (store.current.gen !== gen) return;
      commit((s) => ({ ...s, phase: s.windows[0]?.status === 'loaded' ? 'ready' : 'error' }));
    });
  }, [commit, fetchWindow]);

  useEffect(() => {
    if (today) open();
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestEdge = useCallback((direction) => {
    const s = store.current;
    if (s.phase !== 'ready') return 'none';
    const { lo, hi } = bounds(s.windows);
    const edge = s.windows[direction < 0 ? lo : hi];
    if (edge.status === 'loading') return 'pending';
    if (edge.status === 'failed') return 'none';
    // At the cap the opposite edge makes room: while it is still in flight there is nothing to release
    // without leaving a gap, so the request waits.
    const kept = Object.values(s.windows).filter((w) => w.status !== 'failed').length;
    if (kept >= MAX_WINDOWS && s.windows[direction < 0 ? hi : lo].status === 'loading') return 'pending';
    const k = direction < 0 ? lo - 1 : hi + 1;
    commit((state) => ({
      ...state,
      windows: evictFarthest({ ...state.windows, [k]: placeholder(k, latest.current.today) }, k),
    }), { anchor: true });
    fetchWindow(k);
    return 'started';
  }, [commit, fetchWindow]);

  const requestStart = useCallback(() => requestEdge(-1), [requestEdge]);
  const requestEnd = useCallback(() => requestEdge(1), [requestEdge]);

  const retry = useCallback((k) => {
    commit((s) => (s.windows[k] ? { ...s, windows: { ...s.windows, [k]: { ...s.windows[k], status: 'loading' } } } : s), { anchor: true });
    fetchWindow(k);
  }, [commit, fetchWindow]);

  const reopen = useCallback(() => { if (latest.current.today) open(); }, [open]);

  const reloadWindowsHolding = useCallback((reservationId) => {
    Object.values(store.current.windows)
      .filter((w) => w.status === 'loaded' && w.days.some((d) => [...d.arrivals, ...d.departures].some((r) => r.id === reservationId)))
      .forEach((w) => fetchWindow(w.k));
  }, [fetchWindow]);

  const reloadContributions = useCallback((list) => {
    Object.values(store.current.windows)
      .filter((w) => w.status === 'loaded')
      .forEach((w) => fetchWindow(w.k, { contributionsOnly: list }));
  }, [fetchWindow]);

  const mapDays = useCallback((fn) => commit((s) => ({
    ...s,
    windows: Object.fromEntries(Object.entries(s.windows).map(([k, w]) => [k, { ...w, days: w.days.map(fn) }])),
  })), [commit]);

  const windows = Object.values(snapshot.windows).sort((a, b) => a.k - b.k);
  return {
    phase: snapshot.phase,
    windows,
    version: snapshot,
    requestStart,
    requestEnd,
    retry,
    reopen,
    reloadWindowsHolding,
    reloadContributions,
    mapDays,
  };
}
