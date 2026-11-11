// specs/plugins-phase-1-sdk.md rule 49 — generic sign-in return path (specs/guest-app.md rule 47 is its first user: a backend page that needs a session sends
// the operator to `/login?next=<its path>`) — only a path of this origin, never an open redirect.
import { safeReturnPath } from '../navigation';

test('a path of this origin is returned as it is', () => {
  expect(safeReturnPath('/studio')).toBe('/studio');
  expect(safeReturnPath('/studio/livret?lodging=2')).toBe('/studio/livret?lodging=2');
  expect(safeReturnPath('/planning')).toBe('/planning');
});

test('another origin, a scheme, a backslash, a control character or nothing → home', () => {
  ['//evil.example', 'https://evil.example/studio', 'javascript:alert(1)', '/\\evil.example', '/studio\n', 'studio', '', null, undefined]
    .forEach((raw) => expect(safeReturnPath(raw)).toBe(''));
});

test('never back to the sign-in itself', () => {
  ['/login', '/login?next=/studio', '/login/'].forEach((raw) => expect(safeReturnPath(raw)).toBe(''));
});
