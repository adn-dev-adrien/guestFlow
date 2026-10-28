// specs/hosting-h2-account-security.md rules 47, 48 — « Désactiver », « Nouveaux codes de secours » and
// « Changer d’appli » ask the password and a current code (sent with the call), then do their work; a
// refusal stays in the dialog, and a change of app opens the dialog at step 2.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { apiMock, apiError, media, STATUS_OFF, STATUS_ON, TOTP_ENROLMENT } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

let orig;
beforeEach(() => {
  orig = window.matchMedia;
  window.matchMedia = media();
  vi.clearAllMocks();
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
});
afterEach(() => { window.matchMedia = orig; });

async function fill(code = '123456', password = 'secret') {
  fireEvent.change(await screen.findByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: code } });
}

test('rule 47: « Désactiver » sends the password and the code, and the card goes back to « Désactivée »', async () => {
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
  expect(screen.getByText('Le compte ne sera plus protégé que par le mot de passe.')).toBeInTheDocument();
  api.disableTwoFactor.mockResolvedValue(STATUS_OFF);
  await fill();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(api.disableTwoFactor).toHaveBeenCalledWith('secret', '123456'));
  expect(await screen.findByText('Désactivée')).toBeInTheDocument();
});

test('rule 47: a wrong code is said under the cells and the dialog stays; a locked password is said under the password', async () => {
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
  api.disableTwoFactor.mockRejectedValueOnce(apiError('BAD_CODE', 'Code incorrect.'));
  await fill();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  expect((await screen.findByText('Code incorrect.')).getAttribute('role')).toBe('alert');
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  api.disableTwoFactor.mockRejectedValueOnce(apiError('REAUTH_LOCKED', 'Trop d’essais : réessayer après 14:32.'));
  await fill('654321');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  const locked = await screen.findByText('Trop d’essais : réessayer après 14:32.');
  expect(screen.getByLabelText(/^Mot de passe \(confirmation\)/).getAttribute('aria-describedby')).toContain(locked.id);
});

test('rule 47: « Nouveaux codes de secours » shows the new codes, gated by the saved box', async () => {
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nouveaux codes de secours' }));
  api.regenerateBackupCodes.mockResolvedValue({ backupCodes: ['n3w00-c0d3s'], status: STATUS_ON });
  await fill();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Générer' }));
  await waitFor(() => expect(api.regenerateBackupCodes).toHaveBeenCalledWith('secret', '123456'));
  expect(await screen.findByText('n3w00-c0d3s')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Terminé' })).toBeDisabled();
});

test('rule 48: « Changer d’appli » re-authenticates, then opens the dialog at step 2 on the new secret', async () => {
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Changer d’appli' }));
  api.startTwoFactor.mockResolvedValue({ ...TOTP_ENROLMENT, replacing: true });
  await fill();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continuer' }));
  await waitFor(() => expect(api.startTwoFactor).toHaveBeenCalledWith('totp', 'secret', '123456'));
  expect(await screen.findByText('Étape 1 sur 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
});
