// specs/planning-arrival-alerts.md rules 7–10 (2026-10-27 spec review, F4) — the cleaning alerts come
// from the server keyed by card kind: an arrival card shows the `arrivals` alert of its stay, a
// departure row the `departures` one. A stay's two cards used to share one alert.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../plugins/sdk/useSlot', () => ({ useSlot: () => [] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
vi.mock('../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }));
vi.mock('../../components/sas/ReservationSasDialog', () => ({ default: () => null }));

const { marie, jean } = vi.hoisted(() => ({ marie: {
  id: 1, propertyId: 1, propertyName: 'Gîte', firstName: 'Marie', lastName: 'Durand',
  startDate: '2026-10-25', endDate: '2026-10-27', checkInTime: '15:00', checkOutTime: '10:00', adults: 2,
}, jean: {
  id: 2, propertyId: 1, propertyName: 'Gîte', firstName: 'Jean', lastName: 'Fontaine',
  startDate: '2026-10-27', endDate: '2026-10-30', checkInTime: '13:00', checkOutTime: '10:00', adults: 2,
} }));
const { getPlanningDays } = vi.hoisted(() => ({ getPlanningDays: vi.fn() }));

vi.mock('../../api', () => ({
  default: {
    getPlanningDays: (...args) => getPlanningDays(...args),
    getToday: vi.fn().mockResolvedValue({ today: '2026-10-25' }),
  },
}));

import PlanningPage from '../PlanningPage';
import { daysPayload, stubWindowScroll } from './planningDaysFixtures';

beforeEach(() => { stubWindowScroll(); });

test('each card shows the alert of its own kind, once', async () => {
  getPlanningDays.mockImplementation(async (range) => daysPayload(range, {
    cardsByDate: {
      '2026-10-25': { arrivals: [marie] },
      '2026-10-27': { arrivals: [jean], departures: [marie] },
    },
    alerts: {
      arrivals: { 2: { type: 'red', explanation: 'Marie Durand part le 27/10/2026 à 10:00, ménage: 4h' } },
      departures: { 1: { type: 'red', explanation: 'Arrivée de Jean Fontaine 27/10/2026 à 13:00, ménage: 4h', cleaningDisplay: '4h' } },
    },
  }));
  render(<MemoryRouter><PlanningPage /></MemoryRouter>);
  expect(await screen.findAllByText('Marie Durand part le 27/10/2026 à 10:00, ménage: 4h')).toHaveLength(1);
  expect(screen.getAllByText('Arrivée de Jean Fontaine 27/10/2026 à 13:00, ménage: 4h')).toHaveLength(1);
  expect(getPlanningDays).toHaveBeenCalledWith({ from: '2026-10-25', to: '2026-11-07' });
});
