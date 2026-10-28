// specs/inte-performance.md rules 14–15 — opening an existing reservation reads the property's `stay`
// view (no pricing seasons), no catalogue, and not the whole client list (the search box is hidden).
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: { id: 1, roles: ['admin'], enabledPlugins: [] }, loading: false, logout: () => {} } }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, AuthProvider: ({ children }) => children, useAuth: () => mockAuth }));
vi.mock('../../api', () => {
  const answers = {
    getReservation: { id: 5, propertyId: 1, clientId: 9, startDate: '2027-03-01', endDate: '2027-03-04', adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct', kind: 'reservation', options: [], resources: [] },
    getProperty: { id: 1, name: 'Le Gîte', options: [], optionGroups: { ungrouped: [] }, resources: [] },
    getClient: { id: 9, firstName: 'Camille', lastName: 'Martin' },
    getProperties: [{ id: 1, name: 'Le Gîte' }],
    getToday: { today: '2026-10-28' },
  };
  const api = new Proxy({}, {
    get: (target, name) => {
      if (!target[name]) target[name] = vi.fn(() => Promise.resolve(name in answers ? answers[name] : []));
      return target[name];
    },
  });
  return { __esModule: true, default: api };
});
vi.mock('../../components/DialogProvider', () => {
  const dialogs = { confirm: vi.fn(), alert: vi.fn() };
  const toast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useAppDialogs: () => dialogs, useToast: () => toast };
});

import api from '../../api';
import ReservationPage from '../ReservationPage';

test('rules 14–15: an existing stay reads the stay view of its property, no catalogue, no client list', async () => {
  render(
    <MemoryRouter initialEntries={['/reservations/5']}>
      <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getProperty).toHaveBeenCalled());
  await waitFor(() => expect(api.getClient).toHaveBeenCalledWith(9));
  expect(api.getProperty).toHaveBeenCalledWith(1, 'stay');
  expect(api.getOptions).not.toHaveBeenCalled();
  expect(api.getClients).not.toHaveBeenCalled();
});
