// specs/calendar-property-parity.md rules 25, 29 — the fiche of a cancelled stay is shown, not edited, yet a refund
// stays possible on it (a duplicate set aside takes none): « + Nouveau remboursement » is enabled outside the disabled
// fieldset and opens its dialog; the fieldset carries no opacity.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

// The fiche is a big page: its first import is slow on a cold run.
vi.setConfig({ testTimeout: 30000 });

const showError = vi.fn();
const showSuccess = vi.fn();
let role = 'admin';

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
  useToast: () => ({ showSuccess, showError }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: [role] } }),
  useAuth: () => ({ user: { id: 1, roles: [role] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const CANCELLED = {
  id: 22303, kind: 'cancelled', cancelledAt: '2026-10-01', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622303', options: [], resources: [],
};

function open(fiche) {
  api.getReservation.mockResolvedValue(fiche);
  return render(
    <MemoryRouter initialEntries={[`/reservations/${fiche.id}`]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
});

test('rule 25 — a cancelled fiche keeps « + Nouveau remboursement » usable, the rest is disabled, no opacity', async () => {
  open(CANCELLED);
  const refund = await screen.findByRole('button', { name: '+ Nouveau remboursement' });
  expect(refund).toBeEnabled();
  expect(refund.closest('fieldset')).toBeNull();
  expect(document.querySelector('fieldset').disabled).toBe(true);
  expect(getComputedStyle(document.querySelector('fieldset')).opacity).not.toBe('0.55');
  fireEvent.click(refund);
  expect(await screen.findByRole('dialog')).toHaveTextContent('Nouveau remboursement');
});

test('rule 29 — on a duplicate set aside the refund button stays blocked', async () => {
  open({ ...CANCELLED, id: 22279, kind: 'superseded', cancelledAt: null, supersededByReservationId: 14, supersededByReservationNumber: '202600014' });
  await screen.findByText(/Doublon de la réservation/);
  const refund = screen.getByRole('button', { name: '+ Nouveau remboursement' });
  expect(refund).toBeDisabled();
});
