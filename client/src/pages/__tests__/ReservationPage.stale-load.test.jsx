// Audit R33-C-L1 (specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 7 reading R33-C-L1) — the devis route and the
// reservation route share one ReservationPage. A load still on its way when the page moves to another record (the
// re-read after a re-issued devis save, then « Accepté » converting and navigating) used to land last and fill the
// new reservation's fiche with the devis. A load superseded by a newer one now writes nothing.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
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
  useAppDialogs: () => ({ alert: vi.fn(async () => {}), confirm: vi.fn(async () => false), prompt: vi.fn() }),
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
import { STAY, dayIn, heldAnswers, seedFiche } from './reservationPageHarness';

const DEVIS = {
  id: 77, kind: 'devis', clientId: 1, propertyId: 1, startDate: dayIn(42), endDate: dayIn(45), status: 'accepted',
  validUntil: dayIn(15), expired: false, extendable: false, adults: 2, platform: 'direct', notes: 'note du devis',
  updatedAt: 'v1', options: [], resources: [], customOptions: [],
};

function GoToReservation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(`/reservations/${STAY.id}`)}>aller</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, { ...STAY, notes: 'note de la réservation' });
});

test('R33-C-L1 — a devis load overtaken by the reservation route writes nothing on the reservation\'s fiche', async () => {
  const devisAnswers = heldAnswers(api.getDevisById, () => 'devis', () => DEVIS);
  devisAnswers.hold('devis');
  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <GoToReservation />
        <Routes>
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getDevisById).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'aller' }));
  const notes = await screen.findByLabelText(/^Notes/i);
  await waitFor(() => expect(notes).toHaveValue('note de la réservation'));
  await devisAnswers.release('devis', DEVIS);
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('note de la réservation');
  expect(screen.queryByDisplayValue('note du devis')).not.toBeInTheDocument();
});
