// specs/ui-review-2026-10-19-operations.md rule 26 — the back-button guard puts the page's own router
// state back, never null: after « Rester », « Retour » still knows an app page is behind.
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import useDirtyFormGuard from '../useDirtyFormGuard';
import { hasInAppHistory } from '../../utils/navigation';

afterEach(() => window.history.replaceState(null, '', '/'));

test('rule 26: Back on a dirty form re-pushes the page entry with its idx', () => {
  window.history.replaceState({ usr: null, key: 'k3', idx: 3 }, '', '/settings/etablissement');
  const push = vi.spyOn(window.history, 'pushState');
  const { result } = renderHook(() => useDirtyFormGuard({ draft: { a: 2 }, saved: { a: 1 }, navigate: vi.fn() }));
  expect(result.current.isDirty).toBe(true);
  // The browser has gone back one entry: its state is the previous page's.
  window.history.replaceState({ usr: null, key: 'k2', idx: 2 }, '', '/settings');
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current.guardDialogOpen).toBe(true);
  expect(push).toHaveBeenLastCalledWith({ usr: null, key: 'k3', idx: 3 }, '', expect.any(String));
  expect(hasInAppHistory()).toBe(true);
  push.mockRestore();
});

// specs/options-resources-ux.md rule 29 — the hook's back path keeps the page's own URL, and the global
// navigation slot is held only while dirty.
test('rule 29: Back on a dirty form puts the page URL back, not the URL the browser went to', () => {
  window.history.replaceState({ usr: null, key: 'k3', idx: 3 }, '', '/settings/etablissement');
  const push = vi.spyOn(window.history, 'pushState');
  renderHook(() => useDirtyFormGuard({ draft: { a: 2 }, saved: { a: 1 }, navigate: vi.fn() }));
  window.history.replaceState({ usr: null, key: 'k2', idx: 2 }, '', '/settings');
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(push).toHaveBeenLastCalledWith({ usr: null, key: 'k3', idx: 3 }, '', expect.stringMatching(/\/settings\/etablissement$/));
  push.mockRestore();
});

test('rule 29: guardBack false leaves Back alone', () => {
  const push = vi.spyOn(window.history, 'pushState');
  const { result } = renderHook(() => useDirtyFormGuard({ draft: { a: 2 }, saved: { a: 1 }, navigate: vi.fn(), guardBack: false }));
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current.guardDialogOpen).toBe(false);
  expect(push).not.toHaveBeenCalled();
  push.mockRestore();
});

test('rule 29: the navigation slot is taken only while dirty, and the previous handler is put back', () => {
  const other = vi.fn(() => false);
  window.__guestflowBeforeNavigate = other;
  const { rerender, unmount } = renderHook(({ draft }) => useDirtyFormGuard({ draft, saved: { a: 1 }, navigate: vi.fn() }), { initialProps: { draft: { a: 1 } } });
  expect(window.__guestflowBeforeNavigate).toBe(other);
  rerender({ draft: { a: 2 } });
  expect(window.__guestflowBeforeNavigate).not.toBe(other);
  expect(window.__guestflowBeforeNavigate('/elsewhere')).toBe(true);
  rerender({ draft: { a: 1 } });
  expect(window.__guestflowBeforeNavigate).toBe(other);
  rerender({ draft: { a: 2 } });
  unmount();
  expect(window.__guestflowBeforeNavigate).toBe(other);
  delete window.__guestflowBeforeNavigate;
});

test('rule 29: a clean mounted form leaves the slot empty, and unmounting a clean one does not delete another\'s', () => {
  const { unmount } = renderHook(() => useDirtyFormGuard({ draft: { a: 1 }, saved: { a: 1 }, navigate: vi.fn() }));
  expect(window.__guestflowBeforeNavigate).toBeUndefined();
  const mine = vi.fn(() => false);
  window.__guestflowBeforeNavigate = mine;
  unmount();
  expect(window.__guestflowBeforeNavigate).toBe(mine);
  delete window.__guestflowBeforeNavigate;
});
