// specs/guest-app.md rule 63 (audit R37-C-L1, its class) — the plugin switched off while the studio is open: its
// routes answer the loader's bare 404 `PLUGIN_INACTIVE`, which the operator reads as « Module inactif. », never the
// code; a refusal's French sentence still reaches the operator as it is.
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { api } from '../services/api';

const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
const refusal = async (call) => { try { await call(); } catch (e) { return e; } throw new Error('expected a refusal'); };

afterEach(() => { vi.unstubAllGlobals(); });

describe('studio api — the plugin switched off (rule 63)', () => {
  it('PLUGIN_INACTIVE reads « Module inactif. »', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(404, { error: 'PLUGIN_INACTIVE', plugin: 'guest-app' })));
    const e = await refusal(() => api.lodgings());
    expect(e.message).toBe('Module inactif.');
    expect(e.code).toBe('PLUGIN_INACTIVE');
  });

  it('a French refusal is shown as it is', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(400, { error: 'Page introuvable' })));
    expect((await refusal(() => api.lodgings())).message).toBe('Page introuvable');
  });
});
