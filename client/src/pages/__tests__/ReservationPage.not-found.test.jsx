// specs/ui-review-2026-10-19-operations.md rule 34 — a reservation that does not exist (404) says « introuvable » with a
// way back; a reload that can never succeed is offered only for a failure that may pass (network, 5xx).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';


function open(path = '/reservations/999999') {
  return render(
    <MemoryRouter initialEntries={['/planning', path]} initialIndex={1}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
          <Route path="/planning" element={<div>PLANNING</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }]);
  api.getClients.mockResolvedValue([]);
  api.getReservations.mockResolvedValue([]);
});

test('rule 34: a 404 shows « introuvable » and a way back, no « Réessayer »', async () => {
  api.getReservation.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
  open();
  expect(await screen.findByText('Réservation introuvable.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  expect(screen.queryByText('Impossible de charger la réservation.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retour au planning' }));
  expect(await screen.findByText('PLANNING')).toBeInTheDocument();
});

test('rule 34: any other failure keeps the error with « Réessayer »', async () => {
  api.getReservation.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  open();
  expect(await screen.findByText('Impossible de charger la réservation.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText('Réservation introuvable.')).toBeNull();
});
