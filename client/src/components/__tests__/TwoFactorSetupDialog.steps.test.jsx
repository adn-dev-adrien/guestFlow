// specs/hosting-h2-account-security.md rules 40, 42, 43, 45 — the activation dialog: the password
// step stays put on a refusal, the code is sent at its 6th digit with no button, a wrong code says the
// tries left, the 5th refusal offers « Recommencer », leaving steps 1-2 cancels the enrolment, and
// step 3 closes on « Terminé » only.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { apiMock, apiError, media, TOTP_ENROLMENT, STATUS_ON } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSetupDialog from '../TwoFactorSetupDialog';

let orig;
beforeEach(() => {
  orig = window.matchMedia;
  window.matchMedia = media();
  vi.clearAllMocks();
  api.cancelTwoFactor.mockResolvedValue(null);
});
afterEach(() => { window.matchMedia = orig; });

const renderDialog = (props = {}) => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<TwoFactorSetupDialog open account="marie@x.fr" emailAvailable onClose={onClose} onDone={onDone} {...props} />);
  return { onClose, onDone };
};

async function toStepTwo() {
  api.startTwoFactor.mockResolvedValue(TOTP_ENROLMENT);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  return screen.findByLabelText('Code à 6 chiffres');
}

test('rule 40: a wrong password is said under the field and the step does not move', async () => {
  renderDialog();
  expect(screen.getByText('Étape 1 sur 3')).toBeInTheDocument();
  api.startTwoFactor.mockRejectedValue(apiError('BAD_PASSWORD', 'Mot de passe incorrect.'));
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument();
  expect(screen.getByText('Étape 1 sur 3')).toBeInTheDocument();
  expect(api.startTwoFactor).toHaveBeenCalledWith('totp', 'nope');
  expect(api.cancelTwoFactor).not.toHaveBeenCalled();
});

test('rule 42: the code is sent at its 6th digit, once, with no « Confirmer » button', async () => {
  renderDialog();
  const field = await toStepTwo();
  expect(screen.getByText('Étape 2 sur 3')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Confirmer|Valider/ })).toBeNull();
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  fireEvent.change(field, { target: { value: '12345' } });
  expect(api.confirmTwoFactor).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '123456' } });
  await waitFor(() => expect(api.confirmTwoFactor).toHaveBeenCalledTimes(1));
  expect(api.confirmTwoFactor).toHaveBeenCalledWith('123456');
  expect(await screen.findByText('Étape 3 sur 3')).toBeInTheDocument();
});

test('rule 42: a wrong code says the tries left under the cells and the digits stay', async () => {
  renderDialog();
  const field = await toStepTwo();
  api.confirmTwoFactor.mockRejectedValue(apiError('BAD_CODE', 'Code incorrect : 4 essais restants.', { attemptsLeft: 4 }));
  fireEvent.change(field, { target: { value: '000000' } });
  const alert = await screen.findByText('Code incorrect : 4 essais restants.');
  expect(alert.getAttribute('role')).toBe('alert');
  expect(field.value).toBe('000000');
  fireEvent.change(field, { target: { value: '1' } });
  expect(screen.queryByText('Code incorrect : 4 essais restants.')).toBeNull();
});

test('rules 42-43: the 5th refusal, or an expired enrolment, ends it with « Recommencer » back to step 1', async () => {
  renderDialog();
  const field = await toStepTwo();
  api.confirmTwoFactor.mockRejectedValue(apiError('TOO_MANY_CODES', 'Trop de codes incorrects : activation annulée.'));
  fireEvent.change(field, { target: { value: '000000' } });
  expect(await screen.findByText('Trop de codes incorrects : activation annulée.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Recommencer' }));
  expect(screen.getByText('Étape 1 sur 3')).toBeInTheDocument();
  expect(api.cancelTwoFactor).not.toHaveBeenCalled();

  const second = await toStepTwo();
  api.confirmTwoFactor.mockRejectedValue(apiError('ENROLMENT_EXPIRED', 'Activation expirée : recommencer.'));
  fireEvent.change(second, { target: { value: '000000' } });
  expect(await screen.findByText('Activation expirée : recommencer.')).toBeInTheDocument();
});

test('rule 40: Escape, the close icon and « Annuler » on step 2 cancel the enrolment in progress', async () => {
  const { onClose } = renderDialog();
  await toStepTwo();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(api.cancelTwoFactor).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(api.cancelTwoFactor).toHaveBeenCalledTimes(3);
});

test('rules 40, 45: step 3 has no way out but « Terminé », which waits for the codes to be saved', async () => {
  const { onClose, onDone } = renderDialog();
  const field = await toStepTwo();
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r', 'a1b2c-d3e4f'], status: STATUS_ON });
  fireEvent.change(field, { target: { value: '123456' } });
  await screen.findByText('Étape 3 sur 3');
  expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  fireEvent.mouseDown(document.querySelector('.MuiBackdrop-root'));
  fireEvent.click(document.querySelector('.MuiBackdrop-root'));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId('backup-codes').textContent).toContain('k7m2p-x9q4r');
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }));
  fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
  expect(onDone).toHaveBeenCalledWith(STATUS_ON);
  expect(api.cancelTwoFactor).not.toHaveBeenCalled();
});

test('rule 48: opened with an enrolment (change of app) it starts at step 2 and asks nothing again', () => {
  renderDialog({ initialEnrolment: { ...TOTP_ENROLMENT, replacing: true } });
  expect(screen.getByText('Étape 1 sur 2')).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Mot de passe/)).toBeNull();
});
