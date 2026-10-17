// specs/plugins-phase-4-registry.md rules 5, 18 — the host side of the plugin bundles: the host
// modules a bundle reads instead of its own copies, the entries imported before the app renders,
// and a bundle that fails to load left out without stopping the others.
import { vi } from 'vitest';
import * as React from 'react';
import * as Mui from '@mui/material';
import HOST_EXPORTS from '../hostModules.json';
import { HOST_MODULES, loadPluginBundles } from '../runtime';
import { LOAD_STATE } from '../runtimeModules';
import liveRecord from '../../utils/liveRecord';

test('rules 5, 26: the host exposes exactly what the plugins import — one React, one MUI, not all of it', () => {
  expect(Object.keys(HOST_MODULES).sort()).toEqual(Object.keys(HOST_EXPORTS).sort());
  expect(HOST_MODULES.react.useState).toBe(React.useState);
  expect(HOST_MODULES['@mui/material'].Button).toBe(Mui.Button);
  expect(Object.keys(HOST_MODULES['@mui/material']).sort()).toEqual([...HOST_EXPORTS['@mui/material']].sort());
  expect(HOST_MODULES['@mui/material'].Rating).toBeUndefined();
  expect(typeof HOST_MODULES['guestflow/sdk'].api).toBe('object');
});

test('rule 18: a list of bundles that cannot be read is remembered, so the app says so', async () => {
  LOAD_STATE.entriesError = null;
  await loadPluginBundles({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 502 }), target: [], failures: new Map() });
  expect(LOAD_STATE.entriesError).toBe('HTTP 502');
  LOAD_STATE.entriesError = null;
});

test('rule 18: every listed entry is imported; a failed bundle is remembered and the rest load', async () => {
  const target = [];
  const failures = new Map();
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      { id: 'linen', version: '1.0.0', url: '/plugin-assets/linen/1.0.0/index.js' },
      { id: 'neat', version: '1.0.0', url: '/plugin-assets/neat/1.0.0/index.js' },
    ],
  });
  const importer = vi.fn((url) => (url.includes('neat') ? Promise.reject(new Error('404')) : Promise.resolve({ default: { id: 'linen', contributes: {} } })));
  await loadPluginBundles({ fetchImpl, importer, target, failures });
  expect(globalThis.__GUESTFLOW_HOST__.modules).toBe(HOST_MODULES);
  expect(target.map((m) => m.id)).toEqual(['linen']);
  expect(failures.get('neat')).toBe('404');
});

test('rule 18: the maps derived from the module list follow modules loaded after they were imported', () => {
  const modules = [];
  const routes = liveRecord(() => Object.fromEntries(modules.map((m) => [m.path, m.id])), () => modules.length);
  expect(Object.keys(routes)).toEqual([]);
  modules.push({ id: 'linen', path: '/parametres/stock-blanchisserie' });
  expect(routes['/parametres/stock-blanchisserie']).toBe('linen');
  expect(routes).toEqual({ '/parametres/stock-blanchisserie': 'linen' });
});
