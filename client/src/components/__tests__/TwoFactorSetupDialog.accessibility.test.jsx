// specs/server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
// specs/hosting-h2-account-security.md rules 48, 57, 58 — a replacement counts « n sur 2 », says the
// current app stays valid and offers « Oublier les appareils de confiance »; the check says
// « Vérification… » and keeps the field focusable; focus lands on « Copier » at step 3 and on
// « Recommencer » when the enrolment ended; the step is announced politely.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { apiMock, apiError, media, TOTP_ENROLMENT, STATUS_ON } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSetupDialog from '../TwoFactorSetupDialog';

let orig;
beforeEach(() => { orig = window.matchMedia; window.matchMedia = media(); vi.clearAllMocks(); api.cancelTwoFactor.mockResolvedValue(null); });
afterEach(() => { window.matchMedia = orig; });

const replacement = () => render(
  <TwoFactorSetupDialog open account="m" emailAvailable onClose={() => {}} onDone={() => {}} initialEnrolment={{ ...TOTP_ENROLMENT, replacing: true }} />,
);

test('rule 48: a replacement says « Étape 1 sur 2 » and that the current app stays valid until the new code is validated', () => {
  replacement();
  expect(screen.getByText('Étape 1 sur 2')).toBeInTheDocument();
  expect(screen.getByText('L’appli actuelle reste valable jusqu’à la validation du nouveau code.')).toBeInTheDocument();
  expect(screen.queryByText(/sur 3/)).toBeNull();
});

test('rule 48: « Oublier les appareils de confiance » is ticked by default and its value goes with the confirmation', async () => {
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  replacement();
  const box = screen.getByRole('checkbox', { name: 'Oublier les appareils de confiance' });
  expect(box).toBeChecked();
  fireEvent.click(box);
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  await waitFor(() => expect(api.confirmTwoFactor).toHaveBeenCalledWith('123456', { forgetTrustedDevices: false }));
  expect(await screen.findByText('Étape 2 sur 2')).toBeInTheDocument();
});

test('rule 48: a first activation has no such box and confirms with the code alone', async () => {
  api.startTwoFactor.mockResolvedValue(TOTP_ENROLMENT);
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  render(<TwoFactorSetupDialog open account="m" emailAvailable onClose={() => {}} onDone={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  const code = await screen.findByLabelText('Code à 6 chiffres');
  expect(screen.queryByRole('checkbox', { name: 'Oublier les appareils de confiance' })).toBeNull();
  fireEvent.change(code, { target: { value: '123456' } });
  await waitFor(() => expect(api.confirmTwoFactor).toHaveBeenCalledWith('123456'));
});

test('rule 57: « Vérification… » shows while the code is checked and the field stays focusable', async () => {
  let release;
  api.confirmTwoFactor.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  replacement();
  const field = screen.getByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: '123456' } });
  expect(await screen.findByText('Vérification…')).toBeInTheDocument();
  expect(field).toHaveAttribute('readonly');
  expect(field).not.toBeDisabled();
  release({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  await screen.findByText('Étape 2 sur 2');
});

test('rule 58: focus goes to « Copier » at the codes step and the step is announced', async () => {
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  replacement();
  const live = screen.getByRole('status');
  expect(live.textContent).toBe('Étape 1 sur 2 : Appli');
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  const copy = await screen.findByRole('button', { name: 'Copier' });
  await waitFor(() => expect(document.activeElement).toBe(copy));
  expect(screen.getByRole('status').textContent).toBe('Étape 2 sur 2 : Codes de secours');
});

test('rule 58: when the enrolment has ended focus goes to « Recommencer »', async () => {
  api.confirmTwoFactor.mockRejectedValue(apiError('TOO_MANY_CODES', 'Trop de codes incorrects : activation annulée.'));
  replacement();
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '000000' } });
  const again = await screen.findByRole('button', { name: 'Recommencer' });
  await waitFor(() => expect(document.activeElement).toBe(again));
});
