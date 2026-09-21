import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { vi } from 'vitest';

// Mock the API + auth before importing the page so the imports pick up the mocks.
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    listUsers: vi.fn(),
    updateSelf: vi.fn(),
    // `getMyEmailStatus` drives the red bootstrap-admin warning in SelfProfileSection. The page
    // fires it on mount + after every successful profile save — the mock returns a benign payload
    // by default so tests don't have to worry about unhandled promises.
    getMyEmailStatus: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: vi.fn(),
}));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import UserManagementPage from '../UserManagementPage';

function setAuth(user) {
  useAuth.mockReturnValue({
    user,
    changePassword: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><UserManagementPage /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.listUsers.mockReset();
  api.updateSelf.mockReset();
  api.getMyEmailStatus.mockReset();
  // Default: the seed is gone — no red warning, no test interference.
  api.getMyEmailStatus.mockResolvedValue({ myEmail: null, defaultStillUsed: false });
});

describe('UserManagementPage — the admin user table (Paramètres → Utilisateurs)', () => {
  // specs/settings-rationalization.md rule 6 — the page keeps only the admin table; « Mes
  // informations » and « Mon mot de passe » moved to « Mon compte ».

  test('admin (roles array): shows the table tools and fetches the user list', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', roles: ['admin'] });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    expect(screen.getByRole('button', { name: /Ajouter un compte/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Mon mot de passe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Mes informations/i })).not.toBeInTheDocument();
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('a non-admin reaching the URL gets nothing to manage and no API call', async () => {
    setAuth({ id: 2, email: 'compta@example.com', roles: ['accountant'] });

    renderPage();

    expect(screen.queryByRole('button', { name: /Ajouter un compte/i })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  // Back-compat: pre-M2 sessions still carry `role: 'admin'` (string).
  test('legacy admin session (string `role`): the list is fetched via the back-compat shim', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', role: 'admin' });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('multi-role admin + accountant: admin wins', async () => {
    setAuth({ id: 3, email: 'both@example.com', roles: ['accountant', 'admin'] });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('admin: listUsers failure surfaces an error Alert but does not crash the page', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', roles: ['admin'] });
    api.listUsers.mockRejectedValueOnce({ message: 'NETWORK_DOWN' });

    renderPage();

    await waitFor(() => expect(screen.getByText(/NETWORK_DOWN/)).toBeInTheDocument());
  });
});
