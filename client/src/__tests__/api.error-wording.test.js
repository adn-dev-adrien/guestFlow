// specs/ui-review-2026-10-19-operations.md rule 44 — what api.js throws is a French sentence: a failed connection, an
// answer that is not JSON, a lost session; a refusal keeps its code in `error` and its own message.
import { vi } from 'vitest';
import api from '../api';

const answer = (status, body, statusText = '') => ({
  ok: status < 400,
  status,
  statusText,
  headers: { get: () => null },
  json: body === undefined ? async () => { throw new SyntaxError('Unexpected token <'); } : async () => body,
});
const refusal = async (call) => { try { await call(); } catch (e) { return e; } throw new Error('expected a refusal'); };

afterEach(() => { vi.unstubAllGlobals(); });

test.each([['Chrome', 'Failed to fetch'], ['Safari', 'Load failed'], ['Firefox', 'NetworkError when attempting to fetch resource.']])(
  'rule 44: a network failure reads the same in %s',
  async (_browser, raw) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(raw)));
    const e = await refusal(() => api.getClients());
    expect(e.message).toBe('Connexion au serveur impossible.');
    expect(e.code).toBe('NETWORK');
    expect(e.status).toBeUndefined();
  },
);

test('rule 44: an aborted request stays an AbortError', async () => {
  const abort = new DOMException('Aborted', 'AbortError');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
  const e = await refusal(() => api.getClients());
  expect(e.name).toBe('AbortError');
});

test.each([[502, 'Bad Gateway'], [502, ''], [500, 'Internal Server Error']])(
  'rule 44: a %i with no JSON (statusText « %s ») has one wording',
  async (status, statusText) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(status, undefined, statusText)));
    const e = await refusal(() => api.getClients());
    expect(e.message).toBe('Le serveur ne répond pas correctement.');
    expect(e.status).toBe(status);
  },
);

test('rule 44: a refusal whose JSON says nothing has the same wording', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(500, null, 'Oops')));
  expect((await refusal(() => api.getClients())).message).toBe('Le serveur ne répond pas correctement.');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(500, {}, 'Oops')));
  expect((await refusal(() => api.getClients())).message).toBe('Le serveur ne répond pas correctement.');
});

test('rule 44: a 200 that is not JSON has the same wording', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(200, undefined)));
  expect((await refusal(() => api.getClients())).message).toBe('Le serveur ne répond pas correctement.');
});

test('rule 44: a lost session reads « Session expirée. » and still asks the app to sign in again', async () => {
  const signedOut = vi.fn();
  window.addEventListener('guestflow:unauthenticated', signedOut);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(401, { error: 'UNAUTHENTICATED' })));
  const e = await refusal(() => api.getClients());
  window.removeEventListener('guestflow:unauthenticated', signedOut);
  expect(e.message).toBe('Session expirée.');
  expect(e.error).toBe('UNAUTHENTICATED');
  expect(signedOut).toHaveBeenCalledTimes(1);
});

test('rule 44: a 401 with its own message keeps it, and so does a 401 on the auth routes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(401, { error: 'SUPPORT_ACCESS_ENDED', message: 'Accès du support terminé.' })));
  expect((await refusal(() => api.getClients())).message).toBe('Accès du support terminé.');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(401, { error: 'INVALID_CREDENTIALS' })));
  expect((await refusal(() => api.login('a@b.fr', 'x'))).message).toBe('INVALID_CREDENTIALS');
});

test('rule 44: a refusal keeps its code in `error` and its message wins', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(400, { error: 'SMTP_NOT_CONFIGURED', message: 'Envoi d’e-mails non configuré.' })));
  const e = await refusal(() => api.getClients());
  expect(e.message).toBe('Envoi d’e-mails non configuré.');
  expect(e.error).toBe('SMTP_NOT_CONFIGURED');
});

test.each([
  ['downloadTranslations', () => api.downloadTranslations()],
  ['getDevisPdfBlob', () => api.getDevisPdfBlob(1)],
  ['downloadAccountingSalesCsv', () => api.downloadAccountingSalesCsv(1, 2027)],
  ['downloadEmailTexts', () => api.downloadEmailTexts()],
])('rule 44: %s out of reach says the same sentence', async (_name, call) => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  const e = await refusal(call);
  expect(e.message).toBe('Connexion au serveur impossible.');
  expect(e.code).toBe('NETWORK');
});
