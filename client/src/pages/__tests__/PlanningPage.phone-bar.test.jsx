// specs/shell-and-home-day-first.md rule 23 (2026-10-27 audit) — on a 390 px phone the planning bar
// was an empty band holding only the laundry icon (a plugin node, which the bar never moves to the
// top bar). On a phone the plugin buttons now sit with the date strip and the bar is not drawn.
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
    getPlanningAlerts: vi.fn().mockResolvedValue({ arrivals: {}, departures: {} }),
    getReservations: vi.fn().mockResolvedValue([]),
    getReservation: vi.fn(),
    getBreakfastPlanningSummary: vi.fn().mockResolvedValue({ breakfastByDate: {} }),
    getPlanningOptionCards: vi.fn().mockResolvedValue({ optionCardsByDate: {} }),
    // The server's date, in the week the clocks go back: the window must still end 13 days later,
    // whatever the time zone the suite runs in (specs/ds-sweep-planning.md rule 28).
    getToday: vi.fn().mockResolvedValue({ today: '2026-10-25' }),
  },
}));

import PlanningPage from '../PlanningPage';

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

test('phone: the plugin button sits with the date strip and no empty bar is drawn', async () => {
  const { container } = render(<MemoryRouter><PlanningPage /></MemoryRouter>);
  const button = await screen.findByRole('button', { name: 'Ajouter un voyage blanchisserie exceptionnel' });
  expect(container.querySelector('[data-sticky-bar]')).toBeNull();
  expect(within(button.parentElement).getByRole('button', { name: 'Jour suivant' })).toBeInTheDocument();
});
