// specs/clients.md rule 12 — a new client with the email of an existing one: the server answers 409
// CLIENT_EXISTS, the page asks, and creates a second one only on « Créer quand même ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

const confirmMock = vi.fn();

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getClientsDirectory: vi.fn(),
    getClient: vi.fn(),
    getClientDeleteImpact: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ confirm: confirmMock, alert: vi.fn().mockResolvedValue() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import api from '../../api';
import ClientsPage from '../ClientsPage';
import { directoryPayload } from './clientsDirectoryFixtures';

function existsError() {
  const err = new Error('Client existant : Camille Revue (camille@example.fr).');
  err.code = 'CLIENT_EXISTS';
  err.client = { id: 7 };
  return err;
}

async function fillAndSave(user) {
  render(
    <MemoryRouter initialEntries={['/clients']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/clients" element={<ClientsPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: /Nouveau client/ }));
  await user.type(screen.getByLabelText(/^Nom/), 'Revue');
  await user.type(screen.getByLabelText(/^Prénom/), 'Camille');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn?.mockReset?.());
  confirmMock.mockReset();
  api.getClientsDirectory.mockResolvedValue(directoryPayload());
});

test('a duplicate is asked about; « Annuler » creates nothing more', async () => {
  const user = userEvent.setup();
  api.createClient.mockRejectedValueOnce(existsError());
  confirmMock.mockResolvedValue(false);
  await fillAndSave(user);
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0]).toMatchObject({ title: 'Client existant', message: 'Client existant : Camille Revue (camille@example.fr).' });
  expect(api.createClient).toHaveBeenCalledTimes(1);
});

test('« Créer quand même » sends the same client with allowDuplicate', async () => {
  const user = userEvent.setup();
  api.createClient.mockRejectedValueOnce(existsError()).mockResolvedValueOnce({ id: 8 });
  confirmMock.mockResolvedValue(true);
  await fillAndSave(user);
  await waitFor(() => expect(api.createClient).toHaveBeenCalledTimes(2));
  expect(api.createClient.mock.calls[1][0]).toMatchObject({ lastName: 'Revue', firstName: 'Camille', allowDuplicate: true });
});
