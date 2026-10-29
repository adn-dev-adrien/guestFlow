// specs/plugins-phase-4-registry.md rule 44 — the home renders plugin alerts outside <Slot>: a throwing one,
// or a lazy chunk gone after a plugin update, must leave the rest of the home up.
import React, { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import RouteErrorBoundary from '../ErrorBoundary';

const Stale = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /plugin-assets/linen/1.2.0-abc/x.js')));
const Throws = () => { throw new Error('boom'); };
const Good = () => <p>alerte saine</p>;
vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: (name) => (name === 'dashboard.alerts'
    ? [
      { key: 'linen-shortage', pluginId: 'linen', Component: Stale },
      { key: 'broken', pluginId: 'broken', Component: Throws },
      { key: 'ok', pluginId: 'good', Component: Good },
    ]
    : []),
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../attentionSubjects', () => ({ CORE_ATTENTION_SUBJECTS: {} }));

import { AttentionPinned, LegacyPluginAlerts } from '../AttentionInbox';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

const wrap = (node) => render(
  <MemoryRouter><ThemeProvider theme={theme}><RouteErrorBoundary><p>tableau de bord</p>{node}</RouteErrorBoundary></ThemeProvider></MemoryRouter>,
);

test('legacy plugin alerts: a stale chunk and a throwing alert leave the home and the healthy alert up', async () => {
  wrap(<LegacyPluginAlerts declared={[]} />);
  expect(await screen.findByText('Recharger')).toBeInTheDocument();
  expect(screen.getByText('tableau de bord')).toBeInTheDocument();
  expect(screen.getByText('alerte saine')).toBeInTheDocument();
});

test('pinned subjects contributed by a plugin: a throwing one leaves the home up', async () => {
  wrap(<AttentionPinned subjects={[{ key: 'broken', severity: 'todo', count: 1, title: 't', detail: 'd' }, { key: 'ok', severity: 'todo', count: 1, title: 't2', detail: 'd2' }]} />);
  expect(screen.getByText('tableau de bord')).toBeInTheDocument();
  expect(await screen.findByText('alerte saine')).toBeInTheDocument();
});
