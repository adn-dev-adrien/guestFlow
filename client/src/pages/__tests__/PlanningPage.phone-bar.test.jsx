// specs/shell-and-home-day-first.md rule 23 (2026-10-27 audit) — on a 390 px phone the planning bar
// was an empty band holding only the laundry icon (a plugin node, which the bar never moves to the
// top bar). specs/dashboard-planning-scroll.md rule 22: the plugin buttons stay in the band beside
// « Aujourd'hui »; without any plugin button the lone « Aujourd'hui » icon moves to the top bar; no
// date strip any more.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const slots = {};
vi.mock('../../plugins/sdk/useSlot', () => ({ useSlot: (name) => slots[name] || [] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
const showError = vi.fn();
vi.mock('../../components/DialogProvider', () => ({ useToast: () => ({ showError, showSuccess: vi.fn() }) }));
vi.mock('../../components/sas/ReservationSasDialog', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getPlanningDays: vi.fn(async (range) => (await import('./planningDaysFixtures')).daysPayload(range)),
    // The server's date, in the week the clocks go back: the windows must still be 14 days long,
    // whatever the time zone the suite runs in (specs/ds-sweep-planning.md rule 28).
    getToday: vi.fn().mockResolvedValue({ today: '2026-10-25' }),
  },
}));

import PlanningPage from '../PlanningPage';
import { stubWindowScroll } from './planningDaysFixtures';
import { PageTitleProvider, TopBarActionSlot } from '../../hooks/usePageTitle';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query),
    media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
  slots['planning.actions'] = [{
    pluginId: 'linen', key: 'trip',
    Component: () => <button type="button" aria-label="Ajouter un voyage blanchisserie exceptionnel">L</button>,
  }];
});
afterEach(() => { delete window.matchMedia; });

const mountWithTopBar = () => render(
  <MemoryRouter><PageTitleProvider><TopBarActionSlot /><PlanningPage /></PageTitleProvider></MemoryRouter>,
);

beforeEach(() => { stubWindowScroll(); });

test('rule 22 — phone: the plugin button stays in the band beside « Aujourd\'hui », and no date strip is drawn', async () => {
  const { container } = mountWithTopBar();
  const button = await screen.findByRole('button', { name: 'Ajouter un voyage blanchisserie exceptionnel' });
  const band = container.querySelector('[data-sticky-bar]');
  expect(band).not.toBeNull();
  expect(band).toContainElement(button);
  expect(within(band).getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Jour suivant' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Date de début')).not.toBeInTheDocument();
});

test('rule 22 — phone: with no plugin button the lone « Aujourd\'hui » icon moves to the top bar and no band is drawn', async () => {
  delete slots['planning.actions'];
  const { container } = mountWithTopBar();
  const today = await screen.findByRole('button', { name: "Aujourd'hui" });
  expect(container.querySelector('[data-sticky-bar]')).toBeNull();
  expect(screen.getByTestId('appbar-page-action')).toContainElement(today);
});
