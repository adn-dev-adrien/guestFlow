// specs/plugins-phase-1-sdk.md rule 58 (reading « a draft that comes back is not asked again », loop t26) — a draft that comes back to the
// one on its way keeps that request; back to the latest accepted answer it is current again, not pending, nothing asked; back to a
// failed draft it is asked afresh (loop t24 UI24-2 still holds).
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import useLatestPreview from '../useLatestPreview';

const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
function harness() {
  const outcome = { fail: false };
  const releases = [];
  const fetcher = vi.fn((draft) => (outcome.fail
    ? Promise.reject(offline())
    : new Promise((resolve) => { releases.push(() => resolve({ n: draft.n })); })));
  const view = renderHook(({ n }) => useLatestPreview({ fetcher, draft: { n }, enabled: true, delay: 0 }), { initialProps: { n: 1 } });
  const release = async () => { await act(async () => { releases.splice(0).forEach((go) => go()); }); };
  return { outcome, fetcher, view, release, state: () => view.result.current };
}

test('back to the draft on its way: that request answers it, nothing new is asked', async () => {
  const h = harness();
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(1));
  h.view.rerender({ n: 2 });
  h.view.rerender({ n: 1 });
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.state()).toMatchObject({ pending: true, fresh: false });
  await h.release();
  expect(h.state()).toMatchObject({ data: { n: 1 }, pending: false, fresh: true });
});

test('back to the latest accepted answer: current again, never pending, what was asked since is dropped', async () => {
  const h = harness();
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(1));
  await h.release();
  h.view.rerender({ n: 2 });
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
  h.view.rerender({ n: 1 });
  expect(h.state()).toMatchObject({ data: { n: 1 }, pending: false, fresh: true });
  await h.release();
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  expect(h.state()).toMatchObject({ data: { n: 1 }, fresh: true });
});

test('back to a failed draft: asked afresh, without its older error', async () => {
  const h = harness();
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(1));
  await h.release();
  h.outcome.fail = true;
  h.view.rerender({ n: 2 });
  await waitFor(() => expect(h.state().failed).toBe(true));
  h.outcome.fail = false;
  h.view.rerender({ n: 3 });
  h.view.rerender({ n: 2 });
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
  expect(h.state()).toMatchObject({ failed: false, error: null, pending: true });
  await h.release();
  expect(h.state()).toMatchObject({ data: { n: 2 }, fresh: true });
});

// Loop t26 verifier — the answer kept from before a failure that was put aside (the draft disabled, then asked again on it) is drawn but
// never current: `answerKey` stays null until the new answer, for the very render before the request leaves too.
test('back to an answered draft after another one failed: never current before its own new answer', async () => {
  const outcome = { fail: false };
  const releases = [];
  const fetcher = vi.fn((draft) => (outcome.fail ? Promise.reject(offline()) : new Promise((resolve) => { releases.push(() => resolve({ n: draft.n })); })));
  const seen = [];
  const view = renderHook(({ n, enabled }) => {
    const r = useLatestPreview({ fetcher, draft: { n }, enabled, delay: 0 });
    seen.push({ n, current: r.answerKey != null && r.answerKey === r.draftKey && !r.pending && !r.failed });
    return r;
  }, { initialProps: { n: 1, enabled: true } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => { releases.splice(0).forEach((go) => go()); });
  outcome.fail = true;
  view.rerender({ n: 2, enabled: true });
  await waitFor(() => expect(view.result.current.failed).toBe(true));
  outcome.fail = false;
  view.rerender({ n: 1, enabled: false });
  seen.length = 0;
  view.rerender({ n: 1, enabled: true });
  expect(seen.every((r) => !r.current)).toBe(true);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await act(async () => { releases.splice(0).forEach((go) => go()); });
  expect(view.result.current).toMatchObject({ data: { n: 1 }, fresh: true });
});
