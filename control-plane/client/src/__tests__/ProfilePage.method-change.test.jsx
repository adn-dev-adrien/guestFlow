// specs/control-plane-plans-and-access.md rule 31 — changing the second factor asks for the
// password first: the method buttons stay disabled until it is typed, and it goes with the request.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderAt } from './consoleFixtures';
import ProfilePage from '../pages/ProfilePage';
import api from '../api';

vi.mock('../api', () => ({ default: { mfaStart: vi.fn(), mfaConfirm: vi.fn() } }));

const operator = { email: 'adrien@adn-dev.fr', mfaLabel: 'Code par email', backupCodesLeft: 10 };

it('rule 31 — the password is required to start a change, and is sent with it', async () => {
  api.mfaStart.mockResolvedValue({ method: 'email', message: 'Un code vient d’être envoyé.' });
  renderAt(<ProfilePage operator={operator} onChanged={vi.fn()} />, { path: '/profil', route: '/profil' });
  const app = screen.getByRole('button', { name: 'Appli d’authentification' });
  expect(app).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Code par email' }));
  await waitFor(() => expect(api.mfaStart).toHaveBeenCalledWith('email', 'secret'));
  expect(await screen.findByText('Un code vient d’être envoyé.')).toBeInTheDocument();
});
