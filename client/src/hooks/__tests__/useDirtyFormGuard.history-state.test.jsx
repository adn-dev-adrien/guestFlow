// specs/options-resources-ux.md rule 29 — the global navigation slots a dirty form holds: taken only while
// dirty, previous handler restored, and a clean form never blocks (out-of-order releases included).
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import useDirtyFormGuard from '../useDirtyFormGuard';

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

test('rule 29: out-of-order releases never leave a clean form blocking navigation', () => {
  const a = renderHook(({ draft }) => useDirtyFormGuard({ draft, saved: { a: 1 }, navigate: vi.fn() }), { initialProps: { draft: { a: 2 } } });
  const b = renderHook(() => useDirtyFormGuard({ draft: { a: 3 }, saved: { a: 1 }, navigate: vi.fn() }));
  // A is released first although B holds the slot, then B: the restored handler is A's, now clean.
  a.rerender({ draft: { a: 1 } });
  b.unmount();
  const restored = window.__guestflowBeforeNavigate;
  if (restored) expect(restored('/elsewhere')).toBe(false);
  const back = window.__guestflowBeforeBack;
  if (back) expect(back()).toBeNull();
  a.unmount();
  delete window.__guestflowBeforeNavigate;
  delete window.__guestflowBeforeBack;
});

test('rule 29: guardBack false holds no back slot', () => {
  renderHook(() => useDirtyFormGuard({ draft: { a: 2 }, saved: { a: 1 }, navigate: vi.fn(), guardBack: false }));
  expect(window.__guestflowBeforeBack).toBeUndefined();
  expect(typeof window.__guestflowBeforeNavigate).toBe('function');
  delete window.__guestflowBeforeNavigate;
});
