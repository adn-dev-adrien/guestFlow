// specs/ui-review-2026-10-19-operations.md rule 39 — only the latest request counts.
import { renderHook } from '@testing-library/react';
import useLatestRequest from '../useLatestRequest';

test('rule 39 — a newer begin() supersedes the older one, and unmounting supersedes all', () => {
  const { result, unmount } = renderHook(() => useLatestRequest());
  const first = result.current();
  expect(first()).toBe(true);
  const second = result.current();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  unmount();
  expect(second()).toBe(false);
});
