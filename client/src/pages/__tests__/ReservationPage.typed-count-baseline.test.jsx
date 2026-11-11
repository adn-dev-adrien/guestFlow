// specs/non-card-option-served-persons.md rule 30 — a number typed before a quote lands stays an edit, so it
// can be saved, while a stored count the engine clamps opens clean. Echoes of the real page, quotes held back.
import React from 'react';
import { vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const DUE = { key: 'deposit', label: 'Acompte', amount: 90, state: 'due', tone: 'due', stateLabel: 'À percevoir', action: { kind: 'mark', label: 'Marquer perçu' }, amountEdit: NONE, detail: null };
const OPTION = { id: 40, title: 'Linge', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };
const fiche = (line, extra = {}) => ({
  id: 22340, kind: 'reservation', clientId: 1, propertyId: 1, startDate: addIsoDays(localIsoToday(), 30), endDate: addIsoDays(localIsoToday(), 33),
  platform: 'direct', adults: 4, reservationNumber: '202622340', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  options: [{ optionId: 40, title: 'Linge', quantity: 1, totalPrice: 24, billedUnits: 3, priceType: 'per_person', ...line }],
  resources: [], customOptions: [], ...extra,
});
const answerFor = (body, clampedTo) => {
  const typed = (body.selectedOptions || []).find((o) => Number(o.optionId) === 40);
  const count = typed?.cardPersons ?? null;
  return {
    optionLines: typed ? [{ optionId: 40, title: 'Linge', quantity: 1, totalPrice: 24, billedUnits: 3, priceType: 'per_person', cardPersons: count == null || clampedTo == null ? count : Math.min(count, clampedTo) }] : [],
    resourceLines: [],
  };
};

// Every quote waits until the test lets it go, in the order they were asked.
function holdQuotes() {
  const held = [];
  api.calculatePrice.mockImplementation((body) => new Promise((resolve) => { held.push({ body, resolve }); }));
  return held;
}

function open(stored) {
  api.getReservation.mockResolvedValue(stored);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', maxGuests: 5, singleBeds: 2, doubleBeds: 2 }]);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', maxGuests: 5, singleBeds: 2, doubleBeds: 2, options: [OPTION], resources: [] });
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.updateReservation.mockResolvedValue({ id: 22340 });
  api.markPayment.mockResolvedValue({});
  render(
    <MemoryRouter initialEntries={['/reservations/22340']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const typeCount = (field, value) => {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};
const saveButton = () => screen.getByRole('button', { name: 'Enregistrer' });
const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 150); }); });
const land = (entry, clampedTo) => act(async () => { entry.resolve(answerFor(entry.body, clampedTo)); });
const askedCount = (entry) => (entry.body.selectedOptions || []).find((o) => Number(o.optionId) === 40)?.cardPersons;

beforeEach(() => { vi.clearAllMocks(); });

test('rule 30 — a stored count retyped before the first quote lands can be saved', async () => {
  const held = holdQuotes();
  open(fiche({ cardPersons: 3 }));
  const field = await screen.findByLabelText('Qté');
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  typeCount(field, '2');
  await waitFor(() => expect(askedCount(held[held.length - 1])).toBe(2));
  const last = held[held.length - 1];
  await land(last);
  await waitFor(() => expect(saveButton()).toBeEnabled());
  await settle();
  expect(screen.getByLabelText('Qté')).toHaveValue('2');
  expect(saveButton()).toBeEnabled();
  api.calculatePrice.mockImplementation(async (body) => answerFor(body));
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  const payload = api.updateReservation.mock.calls[0][1];
  expect((payload.options || payload.selectedOptions)[0].cardPersons).toBe(2);
});

test('rule 30 — a following line typed before the first quote lands can be saved', async () => {
  const held = holdQuotes();
  open(fiche({ billedUnits: 4, totalPrice: 32 }));
  const field = await screen.findByLabelText('Qté');
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  typeCount(field, '2');
  await waitFor(() => expect(askedCount(held[held.length - 1])).toBe(2));
  const last = held[held.length - 1];
  await land(last);
  await settle();
  expect(saveButton()).toBeEnabled();
});

test('rule 30 — a stored count above capacity opens clean on the clamped number', async () => {
  const held = holdQuotes();
  open(fiche({ cardPersons: 7, billedUnits: 7, totalPrice: 56 }));
  await screen.findByLabelText('Qté');
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  const first = held[held.length - 1];
  expect(askedCount(first)).toBe(7);
  await land(first, 5);
  await waitFor(() => expect(screen.getByLabelText('Qté')).toHaveValue('5'));
  // The form moved, so the page asks again; that answer changes nothing.
  await waitFor(() => expect(askedCount(held[held.length - 1])).toBe(5));
  const second = held[held.length - 1];
  await land(second, 5);
  await settle();
  expect(saveButton()).toBeDisabled();
});

test('rule 30 — after a payment mark, a count typed before the next quote lands can be saved', async () => {
  const held = holdQuotes();
  const stored = fiche({ cardPersons: 3 }, { depositAmount: 90, depositPaid: 0, ledger: { rows: [DUE], closing: null, remaining: 0 } });
  open(stored);
  await screen.findByLabelText('Qté');
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  const first = held[held.length - 1];
  await land(first);
  await waitFor(() => expect(saveButton()).toBeDisabled());
  // The answer moved the form, so the page may ask again: everything settles before the mark.
  await settle();
  await land(held[held.length - 1]);
  await settle();
  const askedBeforeMark = held.length;

  fireEvent.click(await screen.findByRole('button', { name: /^Marquer perçu/ }));
  fireEvent.change(await screen.findByLabelText('Perçu le'), { target: { value: localIsoToday() } });
  api.getReservation.mockResolvedValue({ ...stored, depositPaid: 1, depositPaidDate: localIsoToday() });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(held.length).toBeGreaterThan(askedBeforeMark));

  typeCount(screen.getByLabelText('Qté'), '2');
  await waitFor(() => expect(askedCount(held[held.length - 1])).toBe(2));
  const last = held[held.length - 1];
  await land(last);
  await settle();
  expect(screen.getByLabelText('Qté')).toHaveValue('2');
  expect(saveButton()).toBeEnabled();
});
