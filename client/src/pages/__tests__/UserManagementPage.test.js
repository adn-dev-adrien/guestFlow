import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the API + auth before importing the page so the imports pick up the mocks.
jest.mock('../../api', () => ({
  __esModule: true,
  default: {
    listUsers: jest.fn(),
  },
}));
jest.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: jest.fn(),
}));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import UserManagementPage from '../UserManagementPage';

function setAuth(user) {
  useAuth.mockReturnValue({
    user,
    changePassword: jest.fn().mockResolvedValue(undefined),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <UserManagementPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.listUsers.mockReset();
});

describe('UserManagementPage — section visibility by role', () => {
  // The page is reachable by every authenticated user. The top "Mon mot de passe" section is
  // always rendered; the "Gestion des comptes" section + the admin-only API call must be gated
  // on the admin role.

  test('admin (roles array): renders both sections and fetches the user list', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', roles: ['admin'] });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    // Section 1 — visible to everyone.
    expect(screen.getByRole('heading', { name: /Mon mot de passe/i })).toBeInTheDocument();
    // Section 2 — admin only.
    expect(screen.getByRole('heading', { name: /Gestion des comptes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ajouter un compte/i })).toBeInTheDocument();
    // The list endpoint was hit (admin can manage everyone).
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('accountant (roles array): renders only "Mon mot de passe", does NOT call listUsers', async () => {
    setAuth({ id: 2, email: 'compta@example.com', roles: ['accountant'] });

    renderPage();

    expect(screen.getByRole('heading', { name: /Mon mot de passe/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Gestion des comptes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter un compte/i })).not.toBeInTheDocument();
    // Allow the effect cycle to flush — there should be no call.
    await Promise.resolve();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  // Back-compat: pre-M2 sessions still carry `role: 'admin'` (string). The shim in
  // constants/roles.js means the admin section must still render.
  test('legacy admin session (string `role`): renders the admin section via the back-compat shim', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', role: 'admin' });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    expect(screen.getByRole('heading', { name: /Gestion des comptes/i })).toBeInTheDocument();
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('multi-role admin + accountant: admin wins (full UI)', async () => {
    setAuth({ id: 3, email: 'both@example.com', roles: ['accountant', 'admin'] });
    api.listUsers.mockResolvedValueOnce({ users: [] });

    renderPage();

    expect(screen.getByRole('heading', { name: /Gestion des comptes/i })).toBeInTheDocument();
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(1));
  });

  test('null user (loading): renders nothing destructive (Mon mot de passe stays rendered)', () => {
    setAuth(null);

    renderPage();

    // The change-password section renders even with no user (the form handles its own state).
    expect(screen.getByRole('heading', { name: /Mon mot de passe/i })).toBeInTheDocument();
    // Admin section absolutely must not appear.
    expect(screen.queryByRole('heading', { name: /Gestion des comptes/i })).not.toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  test('admin: listUsers failure surfaces an error Alert but does not crash the page', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', roles: ['admin'] });
    api.listUsers.mockRejectedValueOnce({ message: 'NETWORK_DOWN' });

    renderPage();

    expect(screen.getByRole('heading', { name: /Gestion des comptes/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/NETWORK_DOWN/)).toBeInTheDocument());
  });
});
