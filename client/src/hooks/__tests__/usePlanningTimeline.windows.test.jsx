// specs/dashboard-planning-scroll.md rules 19, 21, 27, 28 — at most 8 windows (loaded or loading) with both
// edges in flight, an in-flight window never evicted, a failed refresh keeping the days it had.
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const { getPlanningDays } = vi.hoisted(() => ({ getPlanningDays: vi.fn() }));
vi.mock('../../api', () => ({ default: { getPlanningDays: (...args) => getPlanningDays(...args) } }));

import usePlanningTimeline from '../usePlanningTimeline';
import { daysPayload, stay } from '../../pages/__tests__/planningDaysFixtures';

const TODAY = '2026-10-25';
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

function mount(extra = {}) {
  return renderHook(() => usePlanningTimeline({ today: TODAY, contributions: [], holdAnchor: () => {}, onPluginError: () => {}, ...extra }));
}
const ks = (result) => result.current.windows.map((w) => w.k);

beforeEach(() => {
  getPlanningDays.mockReset().mockImplementation(async (range) => daysPayload(range));
});

async function loadTo(result, hi) {
  await waitFor(() => expect(result.current.phase).toBe('ready'));
  for (let k = 2; k <= hi; k += 1) {
    act(() => { result.current.requestEnd(); });
    await waitFor(() => expect(ks(result)).toContain(k));
    await waitFor(() => expect(result.current.windows.find((w) => w.k === k).status).toBe('loaded'));
  }
}

test('rule 27 — with both edges asked the cap holds: the window farthest is released, a window in flight never is, and no gap opens', async () => {
  const { result } = mount();
  await loadTo(result, 6);
  expect(ks(result)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);

  const slowEnd = deferred();
  getPlanningDays.mockImplementation(() => slowEnd.promise);
  act(() => { expect(result.current.requestEnd()).toBe('started'); });
  // Window 7 is in flight and window -1 was released to make room; the other edge has to wait.
  expect(ks(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(result.current.windows.find((w) => w.k === 7).status).toBe('loading');
  act(() => { expect(result.current.requestStart()).toBe('pending'); });
  expect(ks(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  await act(async () => { slowEnd.resolve(daysPayload({ from: '2026-12-06', to: '2026-12-19' })); });
  await waitFor(() => expect(result.current.windows.every((w) => w.status === 'loaded')).toBe(true));
  expect(ks(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  getPlanningDays.mockImplementation(async (range) => daysPayload(range));
  act(() => { expect(result.current.requestStart()).toBe('started'); });
  await waitFor(() => expect(result.current.windows.find((w) => w.k === -1).status).toBe('loaded'));
  expect(ks(result)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);
});

test('rule 27 — a long run of requests on one side never keeps more than 8 windows, always contiguous', async () => {
  const { result } = mount();
  await loadTo(result, 12);
  expect(result.current.windows).toHaveLength(8);
  const list = ks(result);
  expect(list.every((k, i) => i === 0 || k === list[i - 1] + 1)).toBe(true);
  expect(list[list.length - 1]).toBe(12);
});

test('rule 28 — a loaded window that fails to refresh keeps its days and says so', async () => {
  const onReloadError = vi.fn();
  getPlanningDays.mockImplementation(async (range) => daysPayload(range, { cardsByDate: { '2026-10-26': { arrivals: [stay(5)] } } }));
  const { result } = mount({ onReloadError });
  await waitFor(() => expect(result.current.phase).toBe('ready'));
  getPlanningDays.mockRejectedValue(new Error('boom'));
  act(() => { result.current.reloadWindowsHolding(5); });
  await waitFor(() => expect(onReloadError).toHaveBeenCalledTimes(1));
  const middle = result.current.windows.find((w) => w.k === 0);
  expect(middle.status).toBe('loaded');
  expect(middle.days.find((d) => d.date === '2026-10-26').arrivals).toHaveLength(1);
});
