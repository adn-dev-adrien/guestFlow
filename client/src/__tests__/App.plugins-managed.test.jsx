// specs/plugin-operator-provisioning.md rule 3 — the route /parametres/plugins is the app's own 404 for an
// administrator of an operator-managed space, and the Plugins page for the administrator of any other.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: { id: 1, roles: ['admin'], enabledPlugins: [], pluginsManageable: false }, loading: false, logout: () => {} },
}));
vi.mock('../hooks/useAuth', () => ({
  __esModule: true,
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth,
}));
vi.mock('../api', () => {
  const answers = {
    getSystemVersion: { current: '3.10.0', latest: '3.10.0', updateAvailable: false, updateInProgress: false },
    getAttention: { pinned: [], items: [], total: 0 },
    getToday: { today: '2026-10-19' },
    getPlatformColors: { customColors: {} },
    getProperties: [{ id: 1, name: 'Gite' }],
    getPluginsStatus: { mode: 'sources', toConfigure: 0, registry: { configured: false, label: null }, updates: 0, banner: null, updateIds: [], canRestart: false },
    getPluginPage: { plugins: [], message: null },
  };
  const api = new Proxy({}, {
    get: (target, name) => {
      if (!target[name]) target[name] = vi.fn(() => Promise.resolve(name in answers ? answers[name] : []));
      return target[name];
    },
  });
  return { __esModule: true, default: api };
});
vi.mock('../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import App from '../App';

afterEach(() => window.history.pushState({}, '', '/'));

test('rule 3: an administrator of an operator-managed space reads « Page introuvable » on /parametres/plugins', async () => {
  mockAuth.user = { id: 1, roles: ['admin'], enabledPlugins: [], pluginsManageable: false };
  window.history.pushState({}, '', '/parametres/plugins');
  render(<App />);
  expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
});

test('rule 3: the administrator of an unmanaged space (Solio, development) still opens the Plugins page', async () => {
  mockAuth.user = { id: 1, roles: ['admin'], enabledPlugins: [], pluginsManageable: true };
  window.history.pushState({}, '', '/parametres/plugins');
  render(<App />);
  expect(await screen.findByText(/Installés/)).toBeInTheDocument();
  expect(screen.queryByText('Page introuvable')).toBeNull();
});
