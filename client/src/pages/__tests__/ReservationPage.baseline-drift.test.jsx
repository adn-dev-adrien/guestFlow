// specs/reservation-save-keeps-pricing.md rule 7 — a clean fiche whose stored figures drifted from today's quote
// (#22212, #22198, #22199) never flashes « modified »: the baseline is derived in the very render that applies
// the quote, so Enregistrer is not enabled, not even for a frame, when the quote lands.
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
  id: 22212, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622212', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  totalPrice: 220, finalPrice: 297.61, balanceAmount: 297.61, options: [], resources: [],
};

test('a drifted clean fiche never enables Enregistrer when the quote lands', async () => {
  let resolveQuote;
  api.calculatePrice.mockImplementationOnce(() => new Promise((resolve) => { resolveQuote = resolve; }));
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(FICHE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);

  const seen = [];
  const observer = new MutationObserver(() => {
    const save = document.querySelector('button[aria-label="Enregistrer"]');
    if (save) seen.push(save.disabled);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  render(
    <MemoryRouter initialEntries={['/reservations/22212']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByLabelText(/^Notes/i);
  await waitFor(() => expect(resolveQuote).toBeTypeOf('function'));
  // The quote drifts: today's price is not the stored one.
  resolveQuote({ optionLines: [], resourceLines: [], totalPrice: 220, finalPrice: 300.27, balanceAmount: 300.27, depositAmount: 0 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  observer.disconnect();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((disabled) => disabled === true)).toBe(true);
});
