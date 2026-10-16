// specs/plugins-phase-4-registry.md rules 5, 18 — the host side of the plugin bundles: the host
// modules a bundle reads instead of its own copies, the entries imported before the app renders,
// and a bundle that fails to load left out without stopping the others.
import { vi } from 'vitest';
import * as React from 'react';
import * as Mui from '@mui/material';
import HOST_MODULE_NAMES from '../hostModules.json';
import { HOST_MODULES, loadPluginBundles } from '../runtime';
import liveRecord from '../../utils/liveRecord';

test('rule 5: the host exposes exactly the modules the package build leaves external — one React, one MUI', () => {
  expect(Object.keys(HOST_MODULES).sort()).toEqual([...HOST_MODULE_NAMES].sort());
  expect(HOST_MODULES.react.useState).toBe(React.useState);
  expect(HOST_MODULES['@mui/material'].Button).toBe(Mui.Button);
  expect(typeof HOST_MODULES['guestflow/sdk'].api).toBe('object');
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
