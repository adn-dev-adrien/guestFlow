// specs/hosting-h2-account-security.md rules 44, 54 — the email code is the fallback under the app of a FIRST
// activation: the link only exists when the instance can send mail, switching shows the masked address and
// a countdown on « Renvoyer le code », sends the enrolment's token and no password, « Utiliser plutôt une
// appli » goes back to a new secret, and an expired enrolment ends cleanly instead of asking a password.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { apiMock, apiError, media, TOTP_ENROLMENT, EMAIL_ENROLMENT } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSetupDialog from '../TwoFactorSetupDialog';

let orig;
beforeEach(() => { orig = window.matchMedia; window.matchMedia = media(); vi.clearAllMocks(); api.cancelTwoFactor.mockResolvedValue(null); });
afterEach(() => { window.matchMedia = orig; vi.useRealTimers(); });

async function toStepTwo(props = {}) {
  const view = render(<TwoFactorSetupDialog open account="marie@x.fr" emailAvailable onClose={() => {}} onDone={() => {}} {...props} />);
  api.startTwoFactor.mockResolvedValueOnce(TOTP_ENROLMENT);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await screen.findByLabelText('Code à 6 chiffres');
  return view;
}

const LINK = 'Pas d’appli ? Recevoir le code par email';

test('rule 44: the link to the email code exists only when the instance can send mail, and not on a replacement', async () => {
  const first = await toStepTwo({ emailAvailable: false });
  expect(screen.queryByRole('button', { name: LINK })).toBeNull();
  first.unmount();
  const replacement = render(<TwoFactorSetupDialog open account="m" emailAvailable onClose={() => {}} onDone={() => {}} initialEnrolment={{ ...TOTP_ENROLMENT, replacing: true }} />);
  expect(screen.queryByRole('button', { name: LINK })).toBeNull();
  replacement.unmount();
  await toStepTwo();
  expect(screen.getByRole('button', { name: LINK })).toBeInTheDocument();
});

test('rules 44, 54: switching sends the token and no password, shows the masked address and a countdown', async () => {
  await toStepTwo();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.startTwoFactor.mockResolvedValueOnce({ ...EMAIL_ENROLMENT, enrolmentToken: 'tok-1' });
  fireEvent.click(screen.getByRole('button', { name: LINK }));
  expect(await screen.findByText('Code envoyé à m•••e@x.fr, valable 10 minutes.')).toBeInTheDocument();
  expect(api.startTwoFactor).toHaveBeenLastCalledWith('email', undefined, undefined, 'tok-1');
  expect(screen.getByRole('heading', { name: /Email/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Renvoyer le code (60 s)' })).toBeDisabled();
  for (let i = 0; i < 60; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
  const again = screen.getByRole('button', { name: 'Renvoyer le code' });
  expect(again).toBeEnabled();
  api.sendTwoFactorActionCode.mockRejectedValue(apiError('RESEND_TOO_SOON', 'Nouvel envoi possible dans 42 s.', { retryInSeconds: 42 }));
  fireEvent.click(again);
  expect(await screen.findByText('Nouvel envoi possible dans 42 s.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Renvoyer le code (42 s)' })).toBeDisabled();
});

test('rule 44: « Utiliser plutôt une appli » comes back to the app layout with a new secret', async () => {
  await toStepTwo();
  api.startTwoFactor.mockResolvedValueOnce(EMAIL_ENROLMENT).mockResolvedValueOnce({ ...TOTP_ENROLMENT, secret: 'WXYZ WXYZ WXYZ WXYZ' });
  fireEvent.click(screen.getByRole('button', { name: LINK }));
  fireEvent.click(await screen.findByRole('button', { name: 'Utiliser plutôt une appli' }));
  expect(await screen.findByAltText('QR code de l’appli d’authentification')).toBeInTheDocument();
});

test('rule 43: after the 15 minutes the switch ends the enrolment — « Activation expirée » and « Recommencer », never a password error under the code', async () => {
  await toStepTwo();
  api.startTwoFactor.mockRejectedValueOnce(apiError('BAD_PASSWORD', 'Mot de passe incorrect.'));
  fireEvent.click(screen.getByRole('button', { name: LINK }));
  expect(await screen.findByText('Activation expirée : recommencer.')).toBeInTheDocument();
  expect(screen.queryByText('Mot de passe incorrect.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Recommencer' })).toBeInTheDocument();
});

test('rule 44: a refused send (mail down, too many) is said next to the link, not as a code error', async () => {
  await toStepTwo();
  api.startTwoFactor.mockRejectedValueOnce(apiError('EMAIL_UNAVAILABLE', 'Aucun envoi d’email configuré.'));
  fireEvent.click(screen.getByRole('button', { name: LINK }));
  const message = await screen.findByText('Aucun envoi d’email configuré.');
  expect(message.getAttribute('role')).toBe('alert');
  expect(screen.getByLabelText('Code à 6 chiffres').getAttribute('aria-invalid')).toBeNull();
});
