// specs/hosting-h2-account-security.md rules 7-8 and §6 — the second-step screen: a numeric
// one-time-code field, a backup code accepted in the same field, « Faire confiance à cet appareil
// 30 jours » sent with the code, the server's refusal (wrong code, lock) shown as it is worded, and
// « Renvoyer le code » for the email method only.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { resendSecondFactor: vi.fn() },
}));

const completeSecondFactor = vi.fn();
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ completeSecondFactor }),
}));

import api from '../../api';
import SecondFactorForm from '../SecondFactorForm';

const TOTP_STEP = { step: 'second-factor', method: 'totp', message: 'Code à 6 chiffres de l’appli d’authentification.' };

beforeEach(() => {
  completeSecondFactor.mockReset();
  api.resendSecondFactor.mockReset();
});

test('rule 7 — the field is numeric with one-time-code autocomplete, and the trust box is sent along', async () => {
  completeSecondFactor.mockResolvedValue({ id: 1 });
  render(<SecondFactorForm step={TOTP_STEP} onCancel={() => {}} />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  expect(field.getAttribute('inputmode')).toBe('numeric');
  expect(field.getAttribute('autocomplete')).toBe('one-time-code');
  fireEvent.change(field, { target: { value: '12 34 56' } });
  expect(field.value).toBe('123456');
  fireEvent.click(screen.getByLabelText('Faire confiance à cet appareil 30 jours'));
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(completeSecondFactor).toHaveBeenCalledWith('123456', true));
});

test('rule 6 — a backup code goes through the same field', async () => {
  completeSecondFactor.mockResolvedValue({ id: 1 });
  render(<SecondFactorForm step={TOTP_STEP} onCancel={() => {}} />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: 'K7M2P-X9Q4R' } });
  expect(field.value).toBe('k7m2p-x9q4r');
  expect(field.getAttribute('inputmode')).toBe('text');
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(completeSecondFactor).toHaveBeenCalledWith('k7m2p-x9q4r', false));
});

test('rule 8 — a wrong code and the lock are shown as the server words them', async () => {
  completeSecondFactor.mockRejectedValueOnce(Object.assign(new Error('Code incorrect.'), { error: 'BAD_CODE' }));
  render(<SecondFactorForm step={TOTP_STEP} onCancel={() => {}} />);
  const field = screen.getByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(await screen.findByText('Code incorrect.')).toBeTruthy();
  expect(field.value).toBe('');
  completeSecondFactor.mockRejectedValueOnce(Object.assign(new Error('Trop d’essais : réessayer après 10:15.'), { error: 'LOCKED' }));
  fireEvent.change(field, { target: { value: '000001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(await screen.findByText('Trop d’essais : réessayer après 10:15.')).toBeTruthy();
});

test('rule 6 — « Renvoyer le code » only for the email method', async () => {
  const { rerender } = render(<SecondFactorForm step={TOTP_STEP} onCancel={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Renvoyer le code' })).toBeNull();
  api.resendSecondFactor.mockResolvedValue({ message: 'Nouveau code envoyé ; le précédent ne marche plus.' });
  rerender(<SecondFactorForm step={{ ...TOTP_STEP, method: 'email', message: 'Code envoyé à m•••e@x.fr, valable 10 minutes.' }} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Renvoyer le code' }));
  expect(await screen.findByText('Nouveau code envoyé ; le précédent ne marche plus.')).toBeTruthy();
});

test('rule 7 — a pending login that expired goes back to the password', async () => {
  const onCancel = vi.fn();
  completeSecondFactor.mockRejectedValue(Object.assign(new Error('Reconnexion nécessaire.'), { error: 'NO_PENDING_LOGIN' }));
  render(<SecondFactorForm step={TOTP_STEP} onCancel={onCancel} />);
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(onCancel).toHaveBeenCalledWith('Reconnexion nécessaire.'));
});
