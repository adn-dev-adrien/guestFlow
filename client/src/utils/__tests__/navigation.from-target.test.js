// specs/ui-review-2026-10-19-operations.md rule 33 — `?from=` is followed only when it is an in-app path (starts with
// `/`, not `//`). Anything else (a URL, a protocol-relative link, `javascript:`) falls back to the default target
// instead of making React Router throw « External navigation is not allowed ».
import { vi } from 'vitest';
import { getFromParam, navigateBackWithFrom, DEFAULT_BACK_PATH } from '../navigation';

afterEach(() => window.history.replaceState(null, '', '/'));

test.each([
  ['an absolute URL', 'https://evil.example/x'],
  ['a protocol-relative link', '//evil.example/x'],
  ['a javascript: URL', 'javascript:alert(1)'],
  ['a bare word', 'planning'],
  ['a backslash trick', '/\\evil.example'],
])('rule 33: %s is not followed; the default target is used', (_label, from) => {
  window.history.replaceState({ usr: null, key: 'a', idx: 0 }, '', '/reservations/12');
  const navigate = vi.fn();
  navigateBackWithFrom(navigate, from);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(DEFAULT_BACK_PATH, { replace: true });
});

test('rule 33: an in-app path with a query string is still followed', () => {
  const navigate = vi.fn();
  navigateBackWithFrom(navigate, '/calendar?propertyId=2');
  expect(navigate).toHaveBeenCalledWith('/calendar?propertyId=2');
});

test('rule 33: the fallback passed by the caller is kept for a refused target', () => {
  window.history.replaceState({ usr: null, key: 'a', idx: 0 }, '', '/reservations/12');
  const navigate = vi.fn();
  navigateBackWithFrom(navigate, '//evil.example', '/devis');
  expect(navigate).toHaveBeenCalledWith('/devis', { replace: true });
});

test('rule 33: getFromParam hands back only an in-app path, from a string or a URLSearchParams', () => {
  expect(getFromParam('?from=%2Fcalendar%3Fx%3D1')).toBe('/calendar?x=1');
  expect(getFromParam(new URLSearchParams('from=//evil.example'))).toBe('');
  expect(getFromParam('?from=https%3A%2F%2Fevil.example')).toBe('');
  expect(getFromParam('')).toBe('');
});
