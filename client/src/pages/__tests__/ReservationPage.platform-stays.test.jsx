// specs/reservations/platform-stays-always-saveable.md rules 3, 5, 6 — the fiche follows the SERVER's verdict: a platform stay
// above capacity saves with no dialog and shows the information line the quote carries; a direct stay the server judges
// still asks (« Forcer l'enregistrement »).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

const confirm = vi.fn();

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
  useAppDialogs: () => ({ alert: vi.fn(), confirm, prompt: vi.fn() }),
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

const NOTE = 'Booking a vendu 3 nuits ; ces dates en demandent 4 (« Très haute » dès le 10/07). À corriger sur Booking pour les prochaines réservations.';

const FICHE = {
  // date-literal-ok: a stored fiche's dates; nothing here reads the clock
  id: 22301, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2026-11-13', endDate: '2026-11-17',
  platform: 'Booking', adults: 4, children: 0, teens: 0, babies: 0, reservationNumber: '202622301',
  singleBeds: 0, doubleBeds: 0, babyBeds: 0, options: [], resources: [],
};

const quoteOf = (extra) => ({
  totalPrice: 400, finalPrice: 400, nights: 4, nightlyBreakdown: [], optionLines: [], resourceLines: [],
  minNightsBreached: false, maxNightsBreached: false, changeoverBreached: false, ...extra,
});

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

async function saveDirty() {
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Arrivée tardive' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  confirm.mockResolvedValue(false);
  const granja = { id: 1, name: 'Granja', maxGuests: 2, singleBeds: 2, doubleBeds: 2 };
  api.getProperties.mockResolvedValue([granja]);
  api.getProperty.mockResolvedValue(granja);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.updateReservation.mockResolvedValue({ id: 22301 });
});

test('rules 3, 5, 6 — a platform stay above capacity saves with no dialog, and the server note shows under the dates', async () => {
  api.calculatePrice.mockResolvedValue(quoteOf({ capacityJudged: false, stayRuleNotes: [NOTE] }));
  open(FICHE);
  expect(await screen.findByText(NOTE)).toBeInTheDocument();
  await saveDirty();
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  expect(confirm).not.toHaveBeenCalled();
});

test('rule 3 — when the server judges the capacity, a stay above it still asks to be forced', async () => {
  api.calculatePrice.mockResolvedValue(quoteOf({ capacityJudged: true, stayRuleNotes: [] }));
  open({ ...FICHE, platform: 'direct' });
  await saveDirty();
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(confirm.mock.calls[0][0].title).toBe('Capacité du logement dépassée');
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('rule 6 — no note, no line: a quote without stayRuleNotes shows nothing under the dates', async () => {
  api.calculatePrice.mockResolvedValue(quoteOf({ capacityJudged: true, stayRuleNotes: [] }));
  open({ ...FICHE, platform: 'direct', adults: 2 });
  await screen.findByLabelText(/^Notes/i);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(screen.queryByText(/a vendu/)).toBeNull();
});
