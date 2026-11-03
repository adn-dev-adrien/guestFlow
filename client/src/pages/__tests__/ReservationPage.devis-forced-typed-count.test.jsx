// specs/non-card-option-served-persons.md rule 23 — forcing is the decision, on a devis as on a
// reservation: once saved the line is no longer flagged, and the next save does not ask again.
import React from 'react';
import { vi } from 'vitest';
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

import api from '../../api';
import ReservationPage from '../ReservationPage';
import { localIsoToday } from '../../utils/isoDay';

const inDays = (n) => {
  const [y, m, d] = localIsoToday().split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const OPTION = { id: 40, title: 'Linge', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };
const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: inDays(30), endDate: inDays(33), status: 'sent',
  adults: 10, platform: 'direct', notes: '', updatedAt: 'v1',
  options: [{ optionId: 40, title: 'Linge', quantity: 1, totalPrice: 24, billedUnits: 3, priceType: 'per_person', cardPersons: 3 }],
  resources: [], customOptions: [],
};

// The server's reading: a line flagged carries the form-local reference of the party it was typed for.
const ALERT = { optionId: 40, title: 'Linge', kind: 'persons', typed: 3, reference: 10, current: 11, label: 'Saisi pour 10 personnes, groupe : 11', applyLabel: 'Appliquer 11 personnes' };
const quoteFor = (body) => {
  const typed = (body.selectedOptions || []).find((o) => Number(o.optionId) === 40);
  return {
    optionLines: typed ? [{ optionId: 40, title: 'Linge', quantity: 1, totalPrice: 24, billedUnits: 3, priceType: 'per_person', cardPersons: typed.cardPersons }] : [],
    resourceLines: [],
    typedCountAlerts: typed?.typedAtParty != null ? [ALERT] : [],
  };
};

test('rule 23 — a forced devis save clears the flag, and the next save does not ask again', async () => {
  dialogs.confirm.mockResolvedValue(true);
  api.calculatePrice.mockImplementation(async (body) => quoteFor(body));
  api.getDevisById.mockResolvedValue(DEVIS);
  api.updateDevis.mockResolvedValue({ ...DEVIS, updatedAt: 'v2' });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', maxGuests: 13, singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ id: 1, name: 'Granja', maxGuests: 13, singleBeds: 2, doubleBeds: 2, options: [OPTION], resources: [] });

  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const field = await screen.findByLabelText('Qté');
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: '4' } });
  fireEvent.blur(field);
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => (b.selectedOptions || [])[0]?.typedAtParty != null)).toBe(true));

  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
  expect(dialogs.confirm).toHaveBeenCalledTimes(1);
  expect(dialogs.confirm.mock.calls[0][0].title).toBe('Quantités saisies à vérifier');
  await waitFor(() => expect(screen.queryByText('Saisi pour 10 personnes, groupe : 11')).not.toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(2));
  expect(dialogs.confirm).toHaveBeenCalledTimes(1);
  expect((api.updateDevis.mock.calls[1][1].options || api.updateDevis.mock.calls[1][1].selectedOptions)[0].typedAtParty).toBeUndefined();
});
