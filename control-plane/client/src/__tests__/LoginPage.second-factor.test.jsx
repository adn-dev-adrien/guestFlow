// specs/control-plane-plans-and-access.md rule 31 — the console login: the password, then the second
// factor the operator chose, or a backup code; a lockout sends back to the first step.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@gf/theme';
import LoginPage from '../pages/LoginPage';
import api from '../api';

vi.mock('../api', () => ({ default: { login: vi.fn(), verify: vi.fn(), resend: vi.fn() } }));

const show = (onSignedIn = vi.fn()) => {
  render(<ThemeProvider theme={theme}><LoginPage onSignedIn={onSignedIn} /></ThemeProvider>);
  return onSignedIn;
};
const signIn = () => {
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'adrien@adn-dev.fr' } });
  fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
};

beforeEach(() => vi.clearAllMocks());

it('rule 31 — an email code: the message, the resend link, then signed in', async () => {
  api.login.mockResolvedValue({ step: 'second-factor', method: 'email', message: 'Un code à 6 chiffres vient d’être envoyé à a•••n@adn-dev.fr.' });
  api.resend.mockResolvedValue({ message: 'Nouveau code envoyé ; le précédent ne marche plus.' });
  api.verify.mockResolvedValue({ operator: { email: 'adrien@adn-dev.fr' }, notice: null });
  const onSignedIn = show();
  signIn();
  expect(await screen.findByText(/vient d’être envoyé à a•••n@adn-dev\.fr/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer le code' }));
  expect(await screen.findByText(/Nouveau code envoyé/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ email: 'adrien@adn-dev.fr' }, null));
});

it('rule 31 — the app method has no resend; a backup code can replace it', async () => {
  api.login.mockResolvedValue({ step: 'second-factor', method: 'totp', message: 'Saisissez le code à 6 chiffres affiché par votre appli d’authentification.' });
  api.verify.mockResolvedValue({ operator: { email: 'a' }, notice: 'Ce code de secours est maintenant utilisé ; il en reste 9.' });
  const onSignedIn = show();
  signIn();
  expect(await screen.findByText(/votre appli d’authentification/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Renvoyer le code' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
  fireEvent.change(screen.getByLabelText(/Code de secours/), { target: { value: 'k3m9q-7xw2p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.verify).toHaveBeenCalledWith('k3m9q-7xw2p'));
  expect(onSignedIn).toHaveBeenCalledWith({ email: 'a' }, 'Ce code de secours est maintenant utilisé ; il en reste 9.');
});

it('rule 31 — a lockout goes back to the password step with its message', async () => {
  api.login.mockResolvedValue({ step: 'second-factor', method: 'totp', message: 'Saisissez le code.' });
  api.verify.mockRejectedValue(Object.assign(new Error('Trop d’essais : réessayez après 10:15.'), { code: 'LOCKED' }));
  show();
  signIn();
  fireEvent.change(await screen.findByLabelText(/^Code/), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(await screen.findByText('Trop d’essais : réessayez après 10:15.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
});
