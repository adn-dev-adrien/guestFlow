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
