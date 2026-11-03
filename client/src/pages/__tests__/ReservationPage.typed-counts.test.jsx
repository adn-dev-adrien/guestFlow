// specs/non-card-option-served-persons.md rules 8, 19, 22, 23 and 26 (audit R21-S5) — what the page does with a typed
// number: it floors it, drops it when it equals the party or the stay, tags it with what it was typed for unless
// the line is already flagged, keeps those tags out of « modified », asks before saving a flagged line, and clears
// the flags once saved. The server's answers are faked: the page only carries the intent.
import React from 'react';
import { expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };

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
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));
// The save goes back to the list: staying on the page is what lets a test read the field afterwards.
vi.mock('react-router', async (original) => ({ ...(await original()), useNavigate: () => vi.fn() }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const PER_PERSON = { id: 40, title: 'Serviettes', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };
const PER_NIGHT = { id: 41, title: 'Bois', price: 5, priceType: 'per_night', autoEnabled: 0, displayToClient: 1 };
const FICHE = {
  id: 22303, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-15',
  platform: 'direct', adults: 5, reservationNumber: '202622303', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  updatedAt: '2099-01-01 10:00:00', resources: [], ledger: { rows: [], closing: null, remaining: 0 },
};
const ALERT = {
  optionId: 40, title: 'Serviettes', kind: 'persons', typed: 3, reference: 4, current: 5,
  label: 'Saisi pour 4 personnes, groupe : 5', applyLabel: 'Appliquer 5 personnes',
};

let alerts = [];
const lastQuoted = () => api.calculatePrice.mock.calls.at(-1)[0].selectedOptions[0];

// The engine's echo: what the page sent comes back, and a typed count stays on the line.
function fakeQuote(body) {
  return {
    resourceLines: [],
    typedCountAlerts: alerts,
    optionLines: (body.selectedOptions || []).map((line) => ({
      optionId: line.optionId,
      quantity: 1,
      totalPrice: 8 * (line.cardPersons ?? line.cardNights ?? 5),
      cardPersons: line.cardPersons ?? null,
      cardNights: line.cardNights ?? null,
    })),
  };
}

async function openFiche(line, option = PER_PERSON) {
  api.getReservation.mockResolvedValue({ ...FICHE, options: [{ quantity: 1, totalPrice: 24, ...line }] });
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', maxGuests: 13, options: [option] });
  render(
    <MemoryRouter initialEntries={['/reservations/22303']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const field = await screen.findByLabelText(/^Qté/);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  return field;
}

async function type(field, value) {
  const before = api.calculatePrice.mock.calls.length;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
  await waitFor(() => expect(api.calculatePrice.mock.calls.length).toBeGreaterThan(before), { timeout: 3000 });
}

beforeEach(() => {
  vi.clearAllMocks();
  alerts = [];
  api.calculatePrice.mockImplementation(async (body) => fakeQuote(body));
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.updateReservation.mockResolvedValue({});
});

test('rule 8 — a number typed with a decimal is carried as a whole number', async () => {
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  await type(field, '3.7');
  await waitFor(() => expect(lastQuoted().cardPersons).toBe(3));
});

test('rule 4 — a number equal to the party is dropped: the line follows it again', async () => {
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  await type(field, '5');
  await waitFor(() => expect(lastQuoted().cardPersons).toBeUndefined());
  expect(lastQuoted().typedAtParty).toBe(5);
});

test('rule 19 — the same for the nights, against the stay', async () => {
  const field = await openFiche({ optionId: 41, cardNights: 3 }, PER_NIGHT);
  await type(field, '2');
  await waitFor(() => expect(lastQuoted().cardNights).toBeUndefined());
  expect(lastQuoted().typedAtNights).toBe(2);
  await type(field, '4');
  await waitFor(() => expect(lastQuoted().cardNights).toBe(4));
  expect(lastQuoted().cardPersons).toBeUndefined();
});

test('rule 23 — a line not flagged is tagged with the party it is typed for', async () => {
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  await type(field, '2');
  await waitFor(() => expect(lastQuoted().cardPersons).toBe(2));
  expect(lastQuoted().typedAtParty).toBe(5);
});

test('rule 23 — retyping a flagged line keeps its reference, so it stays flagged', async () => {
  alerts = [ALERT];
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
  await type(field, '2');
  await waitFor(() => expect(lastQuoted().cardPersons).toBe(2));
  expect(lastQuoted()).not.toHaveProperty('typedAtParty');
});

test('rule 23 — the typed-against tag is no change of its own: back to the stored number, the fiche is clean', async () => {
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  const save = await screen.findByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).toBeDisabled());
  await type(field, '2');
  await waitFor(() => expect(save).toBeEnabled());
  await type(field, '3');
  await waitFor(() => expect(lastQuoted().typedAtParty).toBe(5));
  await waitFor(() => expect(save).toBeDisabled());
});

test('rule 22 — a flagged line asks before saving: « Annuler » writes nothing, forcing sends the answer', async () => {
  alerts = [ALERT];
  await openFiche({ optionId: 40, cardPersons: 3 });
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'note' } });

  dialogs.confirm.mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.confirm).toHaveBeenCalledTimes(1));
  expect(dialogs.confirm.mock.calls[0][0].title).toBe('Quantités saisies à vérifier');
  expect(dialogs.confirm.mock.calls[0][0].message).toBe('Serviettes : 3. Saisi pour 4 personnes, groupe : 5.');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(api.updateReservation).not.toHaveBeenCalled();

  dialogs.confirm.mockResolvedValueOnce(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(1));
  expect(api.updateReservation.mock.calls[0][1].forceTypedCounts).toBe(true);
});

test('rule 23 — once saved nothing stays flagged, without waiting for a new quote', async () => {
  alerts = [ALERT];
  const field = await openFiche({ optionId: 40, cardPersons: 3 });
  await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'note' } });

  // From the save on, the only thing that can clear the flag is the page itself.
  api.updateReservation.mockImplementation(async () => {
    api.calculatePrice.mockImplementation(() => new Promise(() => {}));
    return {};
  });
  dialogs.confirm.mockResolvedValueOnce(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByLabelText(/^Qté/)).toHaveAttribute('aria-invalid', 'false'));
});
