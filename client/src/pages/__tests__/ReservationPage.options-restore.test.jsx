// specs/non-card-option-served-persons.md rule 31 — what the mid-stay note's « Annuler » puts back, on the real
// page: its capture then its restore give back the lines, the offered set, the bed counters and the welcome
// pack's refusals, each of which removing or adding a line moves. The dialog's half is MidStayNoteDialog.cancel-and-floor.
import React from 'react';
import { vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
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

const LINEN = { id: 40, title: 'Linge de lit', price: 8, priceType: 'per_stay', countsAsBedLinen: 1, autoEnabled: 0, displayToClient: 1 };
const GIFT = { id: 41, title: 'Vin', price: 12, priceType: 'per_stay', autoEnabled: 0, displayToClient: 1 };
const PROPERTY = { id: 1, name: 'Granja', maxGuests: 5, singleBeds: 2, doubleBeds: 2 };
const ctx = () => globalThis.__reservationForm;
const start = () => addIsoDays(localIsoToday(), 30);
const end = () => addIsoDays(localIsoToday(), 33);
const lineIds = () => ctx().form.selectedOptions.map((o) => o.optionId);

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__reservationForm = null;
  api.getProperties.mockResolvedValue([PROPERTY]);
  api.getProperty.mockResolvedValue({ ...PROPERTY, options: [LINEN, GIFT], resources: [] });
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.getPropertyOptionDefaults.mockResolvedValue([]);
  api.getWelcomePack.mockResolvedValue({ lines: [] });
  api.getToday.mockResolvedValue({ today: localIsoToday() });
  api.calculatePrice.mockImplementation(async (body) => ({
    optionLines: (body.selectedOptions || []).map((line) => ({ ...line, title: 'Ligne', totalPrice: 8 })),
    resourceLines: [],
  }));
});

function renderAt(url, path) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path={path} element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// The offered set and the refusals are moved here through the restore itself: `setOptionQuantity` reads their
// trigger from its `setForm` updater, which only runs in the call when React computes it eagerly.
test('rule 31 — capture then restore gives back the lines, the offered set and the beds', async () => {
  api.getReservation.mockResolvedValue({
    id: 22340, kind: 'reservation', clientId: 1, propertyId: 1, startDate: start(), endDate: end(),
    platform: 'direct', adults: 2, reservationNumber: '202622340', singleBeds: 2, doubleBeds: 1, babyBeds: 0,
    options: [{ optionId: 40, title: 'Linge de lit', quantity: 1, totalPrice: 8, billedUnits: 1, priceType: 'per_stay' }],
    resources: [], customOptions: [],
  });
  renderAt('/reservations/22340', '/reservations/:reservationId');
  await waitFor(() => expect(ctx()?.form?.selectedOptions?.some((o) => o.optionId === 40)).toBe(true));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());

  const opening = ctx().captureOptionsState();
  expect(opening.singleBeds).toBe(2);
  expect(opening.doubleBeds).toBe(1);
  expect(opening.offeredOptionIds).toEqual([]);

  act(() => { ctx().setOptionEnabled(40, false); });
  await waitFor(() => expect(lineIds()).toEqual([]));
  const taken = ctx().captureOptionsState();
  expect(taken.singleBeds).toBe('');
  expect(taken.doubleBeds).toBe('');

  act(() => { ctx().restoreOptionsState({ ...taken, offeredOptionIds: [41] }); });
  await waitFor(() => expect(ctx().captureOptionsState().offeredOptionIds).toEqual([41]));

  act(() => { ctx().restoreOptionsState(opening); });
  await waitFor(() => expect(lineIds()).toEqual([40]));
  const restored = ctx().captureOptionsState();
  expect(restored.offeredOptionIds).toEqual([]);
  expect(restored.singleBeds).toBe(2);
  expect(restored.doubleBeds).toBe(1);
});

test('rule 31 — capture then restore gives back the welcome pack refusals, so the pack line returns', async () => {
  api.getWelcomePack.mockResolvedValue({ lines: [{ optionId: 41, mode: 'quantity', quantity: 1 }] });
  renderAt(`/reservations/new?propertyId=1&startDate=${start()}&endDate=${end()}`, '/reservations/new');
  await waitFor(() => expect(ctx()?.form?.selectedOptions?.some((o) => o.optionId === 41)).toBe(true));

  const opening = ctx().captureOptionsState();
  expect(opening.welcomePackOptOut).toEqual([]);

  act(() => { ctx().restoreOptionsState({ ...opening, welcomePackOptOut: [41] }); });
  await waitFor(() => expect(lineIds()).not.toContain(41));
  expect(ctx().captureOptionsState().welcomePackOptOut).toEqual([41]);

  act(() => { ctx().restoreOptionsState(opening); });
  await waitFor(() => expect(lineIds()).toContain(41));
  expect(ctx().captureOptionsState().welcomePackOptOut).toEqual([]);
});
