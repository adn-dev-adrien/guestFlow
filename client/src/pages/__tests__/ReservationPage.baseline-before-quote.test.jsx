// specs/reservation-save-keeps-pricing.md rule 7 — the clean baseline of a loaded fiche is the LOADED form (with what
// the quote writes into it), never the live form: a note typed before the first quote lands is an edit, so
// Enregistrer is enabled and sends it (slow phone, slow server).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const FICHE = {
  id: 22308, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622308', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  options: [], resources: [],
};

test('an edit typed before the first quote resolves stays an edit: Enregistrer is enabled and sends it', async () => {
  let resolveQuote;
  api.calculatePrice.mockImplementationOnce(() => new Promise((resolve) => { resolveQuote = resolve; }));
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.updateReservation.mockResolvedValue({ id: 22308 });
  render(
    <MemoryRouter initialEntries={['/reservations/22308']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Tapée avant le devis' } });
  await waitFor(() => expect(resolveQuote).toBeTypeOf('function'));
  // Still before the quote: the edit can already be saved, and leaving asks first.
  expect(await screen.findByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rester sur la page' }));
  resolveQuote({ optionLines: [], resourceLines: [] });
  const save = await screen.findByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  expect(api.updateReservation.mock.calls[0][1].notes).toBe('Tapée avant le devis');
});
