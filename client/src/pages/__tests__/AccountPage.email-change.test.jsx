// specs/hosting-h2-account-security.md rule 59 — changing the email on « Mon compte » asks the password
// (and the current code of a second step) first; a save that leaves the email alone asks nothing.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import { STATUS_OFF } from '../../components/__tests__/twoFactorFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    listUsers: vi.fn(), updateSelf: vi.fn(), getMyEmailStatus: vi.fn(), getTwoFactorStatus: vi.fn(), sendTwoFactorActionCode: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import AccountPage from '../AccountPage';

const ME = { id: 1, email: 'marie@x.fr', firstName: 'Marie', lastName: 'D', roles: ['admin'] };

function renderPage() {
  api.getMyEmailStatus.mockResolvedValue({ myEmail: null, defaultStillUsed: false });
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  api.updateSelf.mockResolvedValue({ user: ME });
  useAuth.mockReturnValue({ user: ME, changePassword: vi.fn(), refresh: vi.fn() });
  render(
    <MemoryRouter initialEntries={['/mon-compte']}>
      <ThemeProvider theme={theme}><DialogProvider><AccountPage /></DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 59: a changed email opens the confirmation and sends the password with the save', async () => {
  const user = userEvent.setup();
  renderPage();
  const email = await screen.findByLabelText(/^Email/);
  await user.clear(email);
  await user.type(email, 'marie@nouveau.fr');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(api.updateSelf).not.toHaveBeenCalled();
  const password = await screen.findByLabelText(/Mot de passe \(confirmation\)/);
  await user.type(password, 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.updateSelf).toHaveBeenCalledWith(expect.objectContaining({
    email: 'marie@nouveau.fr', currentPassword: 'correct horse battery',
  })));
});

test('rule 59: a wrong password stays in the dialog, under the field', async () => {
  const user = userEvent.setup();
  renderPage();
  api.updateSelf.mockRejectedValue({ error: 'BAD_PASSWORD', message: 'Mot de passe incorrect.' });
  const email = await screen.findByLabelText(/^Email/);
  await user.clear(email);
  await user.type(email, 'marie@nouveau.fr');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await user.type(await screen.findByLabelText(/Mot de passe \(confirmation\)/), 'nope');
  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument();
});

test('rule 59: a save that leaves the email as it is asks for no password', async () => {
  const user = userEvent.setup();
  renderPage();
  const last = await screen.findByLabelText(/^Nom/);
  await user.clear(last);
  await user.type(last, 'Dupont');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateSelf).toHaveBeenCalled());
  expect(screen.queryByLabelText(/Mot de passe \(confirmation\)/)).toBeNull();
});

test('rule 59: when the second-step status cannot be read, the failure is shown and nothing is sent', async () => {
  const user = userEvent.setup();
  renderPage();
  api.getTwoFactorStatus.mockRejectedValue(new Error('down'));
  const email = await screen.findByLabelText(/^Email/);
  await user.clear(email);
  await user.type(email, 'marie@nouveau.fr');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Vérification impossible : réessayer.')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Mot de passe \(confirmation\)/)).toBeNull();
  expect(api.updateSelf).not.toHaveBeenCalled();
});
