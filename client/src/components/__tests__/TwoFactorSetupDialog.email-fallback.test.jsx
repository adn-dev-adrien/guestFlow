// specs/hosting-h2-account-security.md rule 44 — the email code is the fallback under the app: the
// link only exists when the instance can send mail, switching shows the masked address and a
// countdown on « Renvoyer le code », and « Utiliser plutôt une appli » goes back to a new secret.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { apiMock, apiError, media, TOTP_ENROLMENT, EMAIL_ENROLMENT } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSetupDialog from '../TwoFactorSetupDialog';

let orig;
beforeEach(() => { orig = window.matchMedia; window.matchMedia = media(); vi.clearAllMocks(); });
afterEach(() => { window.matchMedia = orig; vi.useRealTimers(); });

const renderStepTwo = (props = {}) => render(
  <TwoFactorSetupDialog open account="marie@x.fr" emailAvailable onClose={() => {}} onDone={() => {}} initialEnrolment={TOTP_ENROLMENT} {...props} />,
);

test('rule 44: the link to the email code exists only when the instance can send mail, and not from the email method', () => {
  const { unmount } = renderStepTwo({ emailAvailable: false });
  expect(screen.queryByRole('button', { name: /Recevoir le code par email/ })).toBeNull();
  unmount();
  const second = renderStepTwo({ currentMethod: 'email' });
  expect(screen.queryByRole('button', { name: /Recevoir le code par email/ })).toBeNull();
  second.unmount();
  renderStepTwo();
  expect(screen.getByRole('button', { name: 'Pas d’appli ? Recevoir le code par email' })).toBeInTheDocument();
});

test('rule 44: switching asks for no password, shows the masked address and a countdown on « Renvoyer le code »', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.startTwoFactor.mockResolvedValue(EMAIL_ENROLMENT);
  renderStepTwo();
  fireEvent.click(screen.getByRole('button', { name: 'Pas d’appli ? Recevoir le code par email' }));
  expect(await screen.findByText('Code envoyé à m•••e@x.fr, valable 10 minutes.')).toBeInTheDocument();
  expect(api.startTwoFactor).toHaveBeenCalledWith('email');
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
  api.startTwoFactor.mockResolvedValueOnce(EMAIL_ENROLMENT).mockResolvedValueOnce({ ...TOTP_ENROLMENT, secret: 'WXYZ WXYZ WXYZ WXYZ' });
  renderStepTwo();
  fireEvent.click(screen.getByRole('button', { name: 'Pas d’appli ? Recevoir le code par email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Utiliser plutôt une appli' }));
  expect(await screen.findByAltText('QR code de l’appli d’authentification')).toBeInTheDocument();
  expect(api.startTwoFactor).toHaveBeenLastCalledWith('totp');
});
