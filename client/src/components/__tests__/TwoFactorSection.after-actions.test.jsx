// specs/hosting-h2-account-security.md rule 58 — after « Désactiver » a toast says so; after « Terminé » the
// focus goes back to the card's first action; under prefers-reduced-motion the folded history opens at once.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { apiMock, media, STATUS_OFF, STATUS_ON, TOTP_ENROLMENT } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

let orig;
beforeEach(() => { orig = window.matchMedia; window.matchMedia = media(); vi.clearAllMocks(); });
afterEach(() => { window.matchMedia = orig; });

test('rule 58: « Désactiver » ends with the toast « Validation en deux étapes désactivée. »', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
  api.disableTwoFactor.mockResolvedValue(STATUS_OFF);
  const notify = vi.fn();
  render(<TwoFactorSection account="m@x.fr" notify={notify} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
  fireEvent.change(await screen.findByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Validation en deux étapes désactivée.'));
});

test('rule 58: after « Terminé » the focus returns to the first action of the card', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  api.startTwoFactor.mockResolvedValue(TOTP_ENROLMENT);
  api.confirmTwoFactor.mockResolvedValue({ backupCodes: ['k7m2p-x9q4r'], status: STATUS_ON });
  render(<TwoFactorSection account="m@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Activer' }));
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  fireEvent.change(await screen.findByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }));
  fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
  const first = await screen.findByRole('button', { name: 'Changer d’appli' });
  await waitFor(() => expect(document.activeElement).toBe(first));
});

test('rule 58: under prefers-reduced-motion the history opens without a transition', async () => {
  window.matchMedia = (query) => ({ ...media()(query), matches: /prefers-reduced-motion/.test(query) });
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
  render(<TwoFactorSection account="m@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Historique (2)' }));
  const item = await screen.findByText(/Mot de passe réinitialisé par lien/);
  expect(item.closest('.MuiCollapse-root').style.transitionDuration || '0ms').toMatch(/^0/);
  expect(within(item.closest('.MuiCollapse-root')).getByText(/activée \(appli\)/)).toBeInTheDocument();
});
