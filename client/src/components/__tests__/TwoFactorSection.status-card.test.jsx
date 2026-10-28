// specs/hosting-h2-account-security.md rules 39, 46 — the card is a status and its actions: off = a
// badge, one sentence and « Activer » (no method picker, no password field); on = the three lines the
// server worded, a warning with « Nouveaux codes » from 3 backup codes left, the history folded.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { apiMock, media, STATUS_OFF, STATUS_ON } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

let orig;
beforeEach(() => { orig = window.matchMedia; window.matchMedia = media(); vi.clearAllMocks(); });
afterEach(() => { window.matchMedia = orig; });

test('rule 39: off, the card is a badge, one sentence and « Activer » — nothing to fill in', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  render(<TwoFactorSection account="marie@x.fr" />);
  expect(await screen.findByText('Désactivée')).toBeInTheDocument();
  expect(screen.getByText('Validation en deux étapes')).toBeInTheDocument();
  expect(screen.getByText('Code de l’appli d’authentification demandé à chaque connexion, en plus du mot de passe.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Mot de passe/)).toBeNull();
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.queryByText(/Second code/)).toBeNull();
});

test('rule 38: « Activer » opens the dialog at step 1 with « Mot de passe (confirmation) » (rule 30)', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Activer' }));
  expect(screen.getByText('Étape 1 sur 3')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Mot de passe \(confirmation\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Mot de passe actuel/)).toBeNull();
});

test('rule 46: on, the card says the method, its date and the codes left as the server worded them', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
  render(<TwoFactorSection account="marie@x.fr" />);
  expect(await screen.findByText('Activée')).toBeInTheDocument();
  expect(screen.getByText('Appli d’authentification · depuis le 12/10/2026')).toBeInTheDocument();
  expect(screen.getByText('8 codes de secours sur 10')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nouveaux codes' })).toBeNull();
  ['Changer d’appli', 'Nouveaux codes de secours', 'Désactiver'].forEach((name) => expect(screen.getByRole('button', { name })).toBeInTheDocument());
});

test('rule 46: from 3 codes left the line warns and « Nouveaux codes » sits next to it', async () => {
  api.getTwoFactorStatus.mockResolvedValue({ ...STATUS_ON, backupCodesLeft: 2, backupCodesLabel: '2 codes de secours sur 10', backupCodesLow: true, backupCodesWarning: 'Plus que 2 codes de secours.' });
  render(<TwoFactorSection account="marie@x.fr" />);
  const warning = await screen.findByText('Plus que 2 codes de secours.');
  expect(warning).toHaveStyle({ fontWeight: '600' });
  fireEvent.click(screen.getByRole('button', { name: 'Nouveaux codes' }));
  expect(await screen.findByRole('dialog', { name: 'Nouveaux codes de secours' })).toBeInTheDocument();
});

test('rule 46: from the email method the button reads « Passer à une appli »', async () => {
  api.getTwoFactorStatus.mockResolvedValue({ ...STATUS_ON, method: 'email', methodLabel: 'Code par email' });
  render(<TwoFactorSection account="marie@x.fr" />);
  expect(await screen.findByRole('button', { name: 'Passer à une appli' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Changer d’appli' })).toBeNull();
});

test('rule 46: the history is folded under « Historique (n) » and opens on a click', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
  render(<TwoFactorSection account="marie@x.fr" />);
  const toggle = await screen.findByRole('button', { name: 'Historique (2)' });
  expect(screen.queryByText(/Mot de passe réinitialisé par lien/)).toBeNull();
  fireEvent.click(toggle);
  expect(await screen.findByText('11/10/2026 11:00 — Mot de passe réinitialisé par lien')).toBeInTheDocument();
});

test('rule 51: startOpen opens the activation once the status says it is off, and tells the parent', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  const handled = vi.fn();
  render(<TwoFactorSection account="marie@x.fr" startOpen onStartHandled={handled} />);
  expect(await screen.findByText('Étape 1 sur 3')).toBeInTheDocument();
  expect(handled).toHaveBeenCalled();
});

test('rule 51: startOpen on an account already protected opens nothing', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_ON);
  const handled = vi.fn();
  render(<TwoFactorSection account="marie@x.fr" startOpen onStartHandled={handled} />);
  await screen.findByText('Activée');
  expect(screen.queryByText('Étape 1 sur 3')).toBeNull();
  expect(handled).toHaveBeenCalled();
});
