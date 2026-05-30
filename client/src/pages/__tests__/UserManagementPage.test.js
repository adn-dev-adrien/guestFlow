import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock the API + auth before importing the page so the imports pick up the mocks.
jest.mock('../../api', () => ({
  __esModule: true,
  default: {
    listUsers: jest.fn(),
    updateSelf: jest.fn(),
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
    refresh: jest.fn().mockResolvedValue(undefined),
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
  api.updateSelf.mockReset();
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

// "Mes informations" section is the new self-service profile editor. It MUST show for every role,
// including non-admins, and a successful submit drives the auth refresh so the sidebar picks up
// the new name immediately.
describe('UserManagementPage — "Mes informations" section', () => {
  test('renders for admin, accountant and legacy-shape sessions', async () => {
    const cases = [
      { roles: ['admin'] },
      { roles: ['accountant'] },
      { role: 'admin' }, // legacy back-compat shim
    ];
    for (const userPart of cases) {
      api.listUsers.mockResolvedValueOnce({ users: [] });
      setAuth({ id: 1, email: 'adrien@example.com', firstName: 'A', lastName: 'B', ...userPart });
      const { unmount } = renderPage();
      expect(screen.getByRole('heading', { name: /Mes informations/i })).toBeInTheDocument();
      unmount();
    }
  });

  test('submit calls api.updateSelf + refresh + shows success snackbar', async () => {
    const user = userEvent.setup();
    const refreshAuth = jest.fn().mockResolvedValue(undefined);
    useAuth.mockReturnValue({
      user: { id: 7, email: 'compta@example.org', firstName: 'A', lastName: 'B', companyName: '', notes: '', roles: ['accountant'] },
      changePassword: jest.fn().mockResolvedValue(undefined),
      refresh: refreshAuth,
    });
    api.updateSelf.mockResolvedValueOnce({ user: { id: 7, firstName: 'Marie', lastName: 'B', email: 'compta@example.org', roles: ['accountant'] } });

    renderPage();
    await user.clear(screen.getByLabelText(/Prénom/));
    await user.type(screen.getByLabelText(/Prénom/), 'Marie');
    await user.click(screen.getByRole('button', { name: /Enregistrer/i }));

    await waitFor(() => expect(api.updateSelf).toHaveBeenCalledTimes(1));
    expect(api.updateSelf).toHaveBeenCalledWith({
      firstName: 'Marie',
      lastName: 'B',
      companyName: '',
      notes: '',
    });
    await waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Vos informations ont été mises à jour/)).toBeInTheDocument());
  });

  test('submit failure with a field error lands under the right input (no snackbar)', async () => {
    const user = userEvent.setup();
    setAuth({ id: 7, email: 'a@b.c', firstName: 'A', lastName: 'B', companyName: '', notes: '', roles: ['accountant'] });
    api.updateSelf.mockRejectedValueOnce({ error: 'FIRSTNAME_REQUIRED', field: 'firstName', detail: 'Le prénom est requis.' });

    renderPage();
    await user.type(screen.getByLabelText(/Note/), 'just to dirty the form');
    await user.click(screen.getByRole('button', { name: /Enregistrer/i }));

    await waitFor(() => expect(screen.getByText('Le prénom est requis.')).toBeInTheDocument());
  });

  test('submit failure with a generic error surfaces as a snackbar', async () => {
    const user = userEvent.setup();
    setAuth({ id: 7, email: 'a@b.c', firstName: 'A', lastName: 'B', companyName: '', notes: '', roles: ['accountant'] });
    api.updateSelf.mockRejectedValueOnce({ message: 'NETWORK_DOWN' });

    renderPage();
    await user.type(screen.getByLabelText(/Note/), 'just to dirty the form');
    await user.click(screen.getByRole('button', { name: /Enregistrer/i }));

    await waitFor(() => expect(screen.getByText(/NETWORK_DOWN/)).toBeInTheDocument());
  });
});
