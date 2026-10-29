// specs/hosting-h2-account-security.md rule 62 — when the login code mail is limited, the login page says
// so (not « Identifiants invalides ») and counts the wait down on the button.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const login = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ login }) }));
vi.mock('../../api', () => ({ __esModule: true, default: { getAuthOptions: vi.fn().mockResolvedValue({}) } }));

import LoginPage from '../LoginPage';

function submit() {
  render(<MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'marie@x.fr' } });
  fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: 'correct horse battery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
}

test('rule 62: a too-early code mail shows the wait and disables the button', async () => {
  login.mockRejectedValue({ error: 'RESEND_TOO_SOON', message: 'Nouvel envoi possible dans 42 s.', retryInSeconds: 42 });
  submit();
  expect(await screen.findByText('Nouvel envoi du code possible dans 42 s.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
});

test('rule 62: the hourly limit is said as the server words it', async () => {
  login.mockRejectedValue({ error: 'TOO_MANY_SENDS', message: 'Trop d’envois : réessayer plus tard.' });
  submit();
  expect(await screen.findByText('Trop d’envois : réessayer plus tard.')).toBeInTheDocument();
});
