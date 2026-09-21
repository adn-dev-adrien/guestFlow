// AccountPage — « Mon compte », every role (specs/settings-rationalization.md rule 6): my information
// and my password, split out of the former « Gestion utilisateur » page.
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
import AccountPage from '../AccountPage';

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
        <DialogProvider><AccountPage /></DialogProvider>
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

describe('AccountPage — what every role sees', () => {
  test.each([
    [{ roles: ['admin'] }],
    [{ roles: ['accountant'] }],
    [{ roles: ['reception'] }],
  ])('%j: « Mon mot de passe » is there, and the user table never is', (userPart) => {
    setAuth({ id: 1, email: 'adrien@example.com', ...userPart });
    renderPage();
    expect(screen.getByRole('heading', { name: /Mon mot de passe/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter un compte/i })).not.toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
  });
});

// "Mes informations" section is the new self-service profile editor. It MUST show for every role,
// including non-admins, and a successful submit drives the auth refresh so the sidebar picks up
// the new name immediately.
describe('AccountPage — "Mes informations" section', () => {
  test('renders for admin, accountant and legacy-shape sessions', async () => {
    const cases = [
      { roles: ['admin'] },
      { roles: ['accountant'] },
      { role: 'admin' }, // legacy back-compat shim
    ];
    for (const userPart of cases) {
      setAuth({ id: 1, email: 'adrien@example.com', firstName: 'A', lastName: 'B', ...userPart });
      const { unmount } = renderPage();
      expect(screen.getByRole('heading', { name: /Mes informations/i })).toBeInTheDocument();
      unmount();
    }
  });

  test('submit calls api.updateSelf + refresh + shows success snackbar', async () => {
    const user = userEvent.setup();
    const refreshAuth = vi.fn().mockResolvedValue(undefined);
    useAuth.mockReturnValue({
      user: { id: 7, email: 'compta@example.org', firstName: 'A', lastName: 'B', companyName: '', notes: '', roles: ['accountant'] },
      changePassword: vi.fn().mockResolvedValue(undefined),
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
      // Email is editable since 2026-06-02 — the form always forwards the current value so
      // a no-op email (same as before) is valid and a real change goes through.
      email: 'compta@example.org',
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
