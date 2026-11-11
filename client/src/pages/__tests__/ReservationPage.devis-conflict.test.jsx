// specs/reservation-fiche-concurrency.md rule 11 (audit R4-1) — the devis editor sends the version it
// loaded; on STALE_FICHE it opens the same three-way dialog as the reservation fiche, and « Enregistrer
// quand même » is the one save that goes without the version.
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

const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17', status: 'sent',
  adults: 2, platform: 'direct', notes: '', updatedAt: '2099-01-01 10:00:00', options: [], resources: [], customOptions: [],
};
const stale = () => Object.assign(new Error('Fiche modifiée entre-temps.'), { code: 'STALE_FICHE', status: 409 });

async function openDevis() {
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getDevisById.mockResolvedValue(DEVIS);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/reservations/new?mode=devis&devisId=77']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
}

beforeEach(() => { api.updateDevis.mockReset(); dialogs.confirm.mockReset(); dialogs.alert.mockReset(); });

test('the devis save sends the version it loaded', async () => {
  api.updateDevis.mockResolvedValue({ ...DEVIS });
  await openDevis();
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(1));
  expect(api.updateDevis.mock.calls[0][1].loadedUpdatedAt).toBe('2099-01-01 10:00:00');
});

test('STALE_FICHE opens the dialog; Annuler keeps the draft and sends nothing more', async () => {
  api.updateDevis.mockRejectedValue(stale());
  dialogs.confirm.mockResolvedValueOnce(false);
  await openDevis();
  await waitFor(() => expect(dialogs.confirm).toHaveBeenCalledTimes(1));
  expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({
    title: 'Fiche modifiée entre-temps', confirmLabel: 'Recharger', secondaryLabel: 'Enregistrer quand même', cancelLabel: 'Annuler',
  });
  expect(api.updateDevis).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed');
});

test('« Recharger » re-reads the devis', async () => {
  api.updateDevis.mockRejectedValue(stale());
  dialogs.confirm.mockResolvedValueOnce(true);
  await openDevis();
  await waitFor(() => expect(api.getDevisById).toHaveBeenCalledTimes(2));
});

test('« Enregistrer quand même » saves once without the version, then holds the new one', async () => {
  api.updateDevis
    .mockRejectedValueOnce(stale())
    .mockResolvedValueOnce({ ...DEVIS, updatedAt: '2099-01-02 09:00:00' })
    .mockResolvedValue({ ...DEVIS, updatedAt: '2099-01-02 09:05:00' });
  dialogs.confirm.mockResolvedValueOnce('secondary');
  await openDevis();
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(2));
  expect(api.updateDevis.mock.calls[0][1].loadedUpdatedAt).toBe('2099-01-01 10:00:00');
  expect(api.updateDevis.mock.calls[1][1].loadedUpdatedAt).toBeUndefined();
  fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'typed again' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(api.updateDevis).toHaveBeenCalledTimes(3));
  expect(api.updateDevis.mock.calls[2][1].loadedUpdatedAt).toBe('2099-01-02 09:00:00');
});
