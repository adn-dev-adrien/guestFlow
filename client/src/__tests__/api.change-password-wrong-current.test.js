// specs/ui-review-2026-10-19-operations.md rule 44, reading of 2026-11-05 (R24-C1) — a wrong current password on « Changer le mot de passe »
// is a refusal of the form, not a lost session: the app stays signed in; a session really gone still signs out.
import { vi } from 'vitest';
import api from '../api';

const answer = (status, body) => ({ ok: status < 400, status, statusText: '', headers: { get: () => null }, json: async () => body });
const refusal = async (call) => { try { await call(); } catch (e) { return e; } throw new Error('expected a refusal'); };

let signedOut;
beforeEach(() => { signedOut = vi.fn(); window.addEventListener('guestflow:unauthenticated', signedOut); });
afterEach(() => { window.removeEventListener('guestflow:unauthenticated', signedOut); vi.unstubAllGlobals(); });

test('a wrong current password keeps the session and its code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(401, { error: 'INVALID_CREDENTIALS' })));
  const e = await refusal(() => api.changePassword('WrongPassword!1', 'NewPassword!2026'));
  expect(e.error).toBe('INVALID_CREDENTIALS');
  expect(e.status).toBe(401);
  expect(signedOut).not.toHaveBeenCalled();
});

test('a session gone on the same call still asks the app to sign in again', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(401, { error: 'UNAUTHENTICATED' })));
  await refusal(() => api.changePassword('Current!2026', 'NewPassword!2026'));
  expect(signedOut).toHaveBeenCalledTimes(1);
});
