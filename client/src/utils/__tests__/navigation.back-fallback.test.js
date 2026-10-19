// specs/ui-review-2026-10-19-operations.md rule 22 — saving or leaving a page opened directly (no
// `from`, nothing of the app behind it in the tab) never leaves the app: it goes to an in-app route.
import { vi } from 'vitest';
import { navigateBack, navigateBackWithFrom, hasInAppHistory, DEFAULT_BACK_PATH } from '../navigation';

afterEach(() => window.history.replaceState(null, '', '/'));

test('rule 22: a page the tab opened on has no in-app history; the planning is the way back', () => {
  window.history.replaceState({ usr: null, key: 'a', idx: 0 }, '', '/reservations/12');
  expect(hasInAppHistory()).toBe(false);
  const navigate = vi.fn();
  navigateBackWithFrom(navigate, '');
  expect(navigate).toHaveBeenCalledWith(DEFAULT_BACK_PATH, { replace: true });
  expect(DEFAULT_BACK_PATH).toBe('/planning');
});

test('rule 22: no router state at all (a guard pushed a bare entry) also falls back', () => {
  window.history.replaceState(null, '', '/reservations/12');
  const navigate = vi.fn();
  navigateBack(navigate, '/devis');
  expect(navigate).toHaveBeenCalledWith('/devis', { replace: true });
});

test('rule 22: with an app page behind, back is one step; a `from` always wins', () => {
  window.history.replaceState({ usr: null, key: 'b', idx: 3 }, '', '/reservations/12');
  const navigate = vi.fn();
  navigateBackWithFrom(navigate, '');
  expect(navigate).toHaveBeenCalledWith(-1);
  navigateBackWithFrom(navigate, '/calendar?propertyId=2');
  expect(navigate).toHaveBeenLastCalledWith('/calendar?propertyId=2');
});
