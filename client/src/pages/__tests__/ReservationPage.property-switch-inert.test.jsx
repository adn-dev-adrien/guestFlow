// specs/per-property-default-options.md rule 11 — while a logement switch reads the new context, the quote and the
// occupancy, the fiche takes no input: an option ticked in that gap would be cleared by the switch's own reset.
import React from 'react';
import { vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../../components/reservation/FinanceSection', async () => {
  const { useReservationForm } = await import('../../components/reservation/ReservationFormContext');
  return {
    __esModule: true,
    default: function ContextProbe() {
      globalThis.__reservationForm = useReservationForm();
      return null;
    },
  };
});

import api from '../../api';
import ReservationPage from '../ReservationPage';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const GIFT = { id: 41, title: 'Vin', price: 12, priceType: 'per_stay', autoEnabled: 0, displayToClient: 1 };
const ctx = () => globalThis.__reservationForm;
const start = () => addIsoDays(localIsoToday(), 30);
const end = () => addIsoDays(localIsoToday(), 33);

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__reservationForm = null;
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja' }, { id: 2, name: 'Estiva' }]);
  api.getProperty.mockImplementation(async (id) => ({ id, name: id === 1 ? 'Granja' : 'Estiva', options: [GIFT], resources: [] }));
  api.getClients.mockResolvedValue([]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.getPropertyOptionDefaults.mockResolvedValue([]);
  api.getWelcomePack.mockResolvedValue({ lines: [] });
  api.getToday.mockResolvedValue({ today: localIsoToday() });
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [], totalPrice: 0 });
});

async function openFiche() {
  render(
    <MemoryRouter initialEntries={[`/reservations/new?propertyId=1&startDate=${start()}&endDate=${end()}`]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ctx()?.propertyOptions?.length).toBe(1));
  await waitFor(() => expect(ctx().formReadOnly).toBe(false));
}

test('the fiche is read-only and inert from the switch until the new options are applied', async () => {
  await openFiche();
  let releaseOccupancy;
  api.getReservations.mockImplementation(() => new Promise((resolve) => { releaseOccupancy = () => resolve([]); }));
  let switched;
  act(() => { switched = ctx().handleReservationPropertyChange(2); });

  await waitFor(() => expect(ctx().formReadOnly).toBe(true));
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  expect(document.querySelector('fieldset[aria-busy="true"]')).not.toBeNull();
  expect(document.querySelector('fieldset[inert]')).not.toBeNull();

  // Every save-first action (PDF, payment request, « Accepté », unsaved-changes dialog) goes through this entry point.
  let refused;
  await act(async () => { refused = await ctx().saveThenRun(() => {}); });
  expect(refused).toBe(false);

  await act(async () => { releaseOccupancy(); await switched; });
  await waitFor(() => expect(ctx().formReadOnly).toBe(false));
  expect(document.querySelector('fieldset[aria-busy="true"]')).toBeNull();
  expect(api.createReservation).not.toHaveBeenCalled();
});

test('a switch that fails still gives the fiche back', async () => {
  await openFiche();
  api.getReservations.mockRejectedValue(new Error('offline'));
  await act(async () => { await ctx().handleReservationPropertyChange(2).catch(() => {}); });
  await waitFor(() => expect(ctx().formReadOnly).toBe(false));
});
