// specs/ui-review-2026-10-19-operations.md rule 53 (audit R37-C-L1, its class) — a plugin switched off while its page
// is open answers the loader's bare 404 `PLUGIN_INACTIVE`: the operator reads « Module inactif. », never the code;
// the code stays in `error` for the callers that branch on it.
import { vi } from 'vitest';
import api from '../api';

const answer = (status, body) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => null }, json: async () => body,
});
const refusal = async (call) => { try { await call(); } catch (e) { return e; } throw new Error('expected a refusal'); };

afterEach(() => { vi.unstubAllGlobals(); });

test('rule 53: PLUGIN_INACTIVE reads « Module inactif. » and keeps its code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(404, { error: 'PLUGIN_INACTIVE', plugin: 'guest-app' })));
  const e = await refusal(() => api.getClients());
  expect(e.message).toBe('Module inactif.');
  expect(e.error).toBe('PLUGIN_INACTIVE');
  expect(e.plugin).toBe('guest-app');
  expect(e.status).toBe(404);
});

test('rule 53: any other code-only refusal keeps reading as before', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(400, { error: 'Libellé requis.' })));
  expect((await refusal(() => api.getClients())).message).toBe('Libellé requis.');
});
