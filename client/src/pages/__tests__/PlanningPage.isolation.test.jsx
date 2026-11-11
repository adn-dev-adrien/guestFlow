// specs/plugins-phase-4-registry.md rule 44 — a planning day card or bar button whose plugin component
// throws leaves the planning, and the healthy cards, up.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const slots = {};
vi.mock('../../plugins/sdk/useSlot', () => ({ useSlot: (name) => slots[name] || [] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
vi.mock('../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }));
vi.mock('../../components/sas/ReservationSasDialog', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getPlanningDays: vi.fn(async (range) => (await import('./planningDaysFixtures')).daysPayload(range)),
    getToday: vi.fn().mockResolvedValue({ today: '2026-10-25' }),
  },
}));

import PlanningPage from '../PlanningPage';
import RouteErrorBoundary from '../../components/ErrorBoundary';
import { stubWindowScroll } from './planningDaysFixtures';

const Throws = () => { throw new Error('boom'); };
const Healthy = ({ date }) => <p data-testid="healthy">{`carte saine ${date}`}</p>;
const dayOf = (pluginId, key, rank, Component) => ({
  pluginId, key, rank, Component, load: vi.fn(async () => ({ '2026-10-25': { n: 1 } })),
});

beforeEach(() => {
  stubWindowScroll();
  Object.keys(slots).forEach((k) => delete slots[k]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test('a throwing day card and a throwing bar button leave the planning and the healthy card up', async () => {
  slots['planning.days'] = [dayOf('bad', 'bad-card', 10, Throws), dayOf('good', 'good-card', 20, Healthy)];
  slots['planning.actions'] = [{ pluginId: 'bad', key: 'bad-action', Component: Throws }];
  render(<MemoryRouter><RouteErrorBoundary><PlanningPage /></RouteErrorBoundary></MemoryRouter>);

  expect((await screen.findAllByTestId('healthy')).length).toBeGreaterThan(0);
  await waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:bad]'), expect.any(Error)));
  expect(screen.queryByText(/Une erreur est survenue/)).toBeNull();
});
