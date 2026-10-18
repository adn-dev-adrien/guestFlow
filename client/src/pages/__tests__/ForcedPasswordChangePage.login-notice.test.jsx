// specs/plugins-phase-p-productisation.md rule 33 — after the forced first password change, the login
// opens with its confirmation and the account's email filled in.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const changePassword = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { email: 'admin@guestflow.local', mustChangePassword: true }, changePassword, login: vi.fn() }),
}));
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getAuthOptions: () => Promise.resolve({}) },
}));

import ForcedPasswordChangePage from '../ForcedPasswordChangePage';
import LoginPage from '../LoginPage';

test('the change leaves for the login with the notice and the email', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ForcedPasswordChangePage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const fields = screen.getAllByLabelText(/mot de passe/i);
  fireEvent.change(fields[0], { target: { value: 'ChangeMe!2026' } });
  fireEvent.change(fields[1], { target: { value: 'Un-nouveau-mot-2026' } });
  fireEvent.change(fields[2], { target: { value: 'Un-nouveau-mot-2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Définir le mot de passe' }));

  await waitFor(() => expect(screen.getByText('Mot de passe modifié. Connexion avec le nouveau mot de passe.')).toBeInTheDocument());
  expect(changePassword).toHaveBeenCalledWith('ChangeMe!2026', 'Un-nouveau-mot-2026', { wasMustChange: true });
  expect(screen.getByLabelText(/Email/)).toHaveValue('admin@guestflow.local');
  expect(document.activeElement).toBe(screen.getByLabelText(/^Mot de passe/));
});
