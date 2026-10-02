// specs/plugins-phase-1-sdk.md rules 2-3 and 13-15 — the client side of the plugin contract: the
// module list, isolation, slots, contributed routes and menu entries.
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const enabled = new Set();
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

import PLUGIN_MODULES from '../../index';
import { allContributions, contributionsFor } from '../registry';
import Slot from '../Slot';
import { ROUTE_PLUGINS, MODULE_ROUTE_ROLES, isRouteEnabled } from '../../../constants/plugins';
import { SETTINGS_MENU } from '../../../constants/settingsMenu';

const SRC = path.resolve(__dirname, '../../..');

beforeEach(() => enabled.clear());

// specs/plugins-phase-2-hosts.md rule 1 — phase 2 adds accounting-export, linen, sas, website-booking.
test('rule 2: the modules are listed once', () => {
  expect(PLUGIN_MODULES.map((m) => m.id).sort()).toEqual([
    'accounting-export', 'gate-access', 'google-calendar', 'linen', 'online-payment', 'sas', 'school-holidays',
    'tariff-recipes', 'weather-alerts', 'website-booking',
  ]);
});

function readTree(dir, acc = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') readTree(full, acc); continue; }
    if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) acc[path.relative(SRC, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
  return acc;
}

// Rule 3 — a plugin file imports its folder, the SDK or npm; the core imports only the module list
// and the SDK.
function importViolations(files) {
  const out = [];
  for (const [rel, source] of Object.entries(files)) {
    const inPlugin = rel.match(/^plugins\/([^/]+)\//);
    for (const m of source.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (inPlugin && inPlugin[1] !== 'sdk') {
        if (!target.startsWith(`plugins/${inPlugin[1]}`) && !target.startsWith('plugins/sdk')) out.push(`${rel} → ${m[1]}`);
      } else if (!inPlugin && rel !== 'plugins/index.js') {
        const t = target.match(/^plugins\/([^/.]+)/);
        if (t && t[1] !== 'sdk' && t[1] !== 'index') out.push(`${rel} → ${m[1]}`);
      }
    }
  }
  return out;
}

// Rule 16 — the SDK is the plugin's only door to the core (api, hooks, generic components).
test('rules 3, 16: no plugin reaches into the core outside the SDK, and the core imports no plugin folder', () => {
  expect(importViolations(readTree(SRC))).toEqual([]);
});

test('rule 3: the walk catches a planted violation in either direction', () => {
  expect(importViolations({
    'plugins/weather-alerts/X.jsx': "import api from '../../api';",
    'pages/Y.jsx': "import Card from '../plugins/gate-access/GateAccessCard';",
    'plugins/gate-access/Z.jsx': "import { api } from '../sdk'; import K from './keys';",
  })).toEqual([
    'plugins/weather-alerts/X.jsx → ../../api',
    'pages/Y.jsx → ../plugins/gate-access/GateAccessCard',
  ]);
});

test('rule 13: a slot keeps the contributions of active plugins only, in their order', () => {
  const modules = [
    { id: 'a', contributes: { s: [{ key: 'late', order: 50 }, { key: 'early', order: 5 }] } },
    { id: 'b', contributes: { s: [{ key: 'mid', order: 20 }] } },
  ];
  expect(allContributions('s', modules).map((c) => c.key)).toEqual(['late', 'early', 'mid']);
  const user = { enabledPlugins: ['a'] };
  expect(contributionsFor('s', user, modules).map((c) => `${c.pluginId}:${c.key}`)).toEqual(['a:early', 'a:late']);
});

test('rules 13-14: <Slot> renders an active plugin’s lazy component, and nothing for an inactive one', async () => {
  const { container, rerender } = render(<Slot name="dashboard.alerts.urgent" />);
  expect(container.innerHTML).toBe('');
  enabled.add('gate-access');
  const Probe = vi.fn(() => <p>clés du portail</p>);
  vi.doMock('../../gate-access/GateKeysAlert', () => ({ default: Probe }));
  rerender(<Slot name="dashboard.alerts.urgent" />);
  expect(await screen.findByText('clés du portail')).toBeTruthy();
});

test('rule 15: contributed pages join the route guard with the roles their module declares', () => {
  expect(ROUTE_PLUGINS['/school-holidays']).toBe('school-holidays');
  expect(ROUTE_PLUGINS['/parametres/recettes']).toBe('tariff-recipes');
  expect(MODULE_ROUTE_ROLES['/parametres/recettes']).toEqual(['admin']);
  expect(isRouteEnabled({ enabledPlugins: [] }, '/school-holidays')).toBe(false);
  expect(isRouteEnabled({ enabledPlugins: ['school-holidays'] }, '/school-holidays')).toBe(true);
});

test('rule 13: the recipes entry of the settings menu sits right after « Options & ressources »', () => {
  const paths = SETTINGS_MENU.filter(Boolean).map((e) => e.path);
  expect(paths[paths.indexOf('/parametres/options-ressources') + 1]).toBe('/parametres/recettes');
});
