// specs/hosting-h2-account-security.md rules 41, 52 — step 2 is built for the device it runs on,
// chosen by `(pointer: coarse)`: a phone gets the otpauth:// link and the key to copy with the QR code
// folded; a computer gets the QR code with the key folded.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { apiMock, media, TOTP_ENROLMENT } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import TwoFactorSetupDialog from '../TwoFactorSetupDialog';

let orig;
beforeEach(() => { orig = window.matchMedia; });
afterEach(() => { window.matchMedia = orig; });

const renderStepTwo = () => render(
  <TwoFactorSetupDialog open account="marie@x.fr" emailAvailable onClose={() => {}} onDone={() => {}} initialEnrolment={TOTP_ENROLMENT} />,
);

test('rule 41: a coarse pointer offers « Ouvrir dans l’appli » with the server\'s otpauth link first, the QR folded', () => {
  window.matchMedia = media({ coarse: true, phone: true });
  renderStepTwo();
  const open = screen.getByRole('link', { name: 'Ouvrir dans l’appli d’authentification' });
  expect(open.getAttribute('href')).toBe(TOTP_ENROLMENT.otpauthUri);
  expect(screen.getByTestId('setup-key').textContent).toContain('ABCD EFGH IJKL MNOP');
  expect(screen.queryByAltText('QR code de l’appli d’authentification')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Afficher le QR code/ }));
  expect(screen.getByAltText('QR code de l’appli d’authentification')).toBeInTheDocument();
  expect(screen.getByText('Nom dans l’appli : GuestFlow — Domaine des Oliviers · marie@x.fr')).toBeInTheDocument();
});

test('rule 41: a fine pointer shows the QR code first and folds the key behind « Saisie manuelle de la clé »', () => {
  window.matchMedia = media({ coarse: false });
  renderStepTwo();
  expect(screen.getByAltText('QR code de l’appli d’authentification')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Ouvrir dans l’appli/ })).toBeNull();
  expect(screen.queryByTestId('setup-key')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Saisie manuelle de la clé' }));
  const groups = screen.getByTestId('setup-key').querySelectorAll('span');
  expect([...groups].map((g) => g.textContent)).toEqual(['ABCD', 'EFGH', 'IJKL', 'MNOP']);
  expect(groups[0]).toHaveStyle({ whiteSpace: 'nowrap', display: 'inline-block' });
  expect(screen.getByText('Basé sur l’heure · 6 chiffres · 30 s')).toBeInTheDocument();
});

test('rule 41: « Copier la clé » on a computer copies the same compact key', async () => {
  window.matchMedia = media({ coarse: false });
  const writeText = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderStepTwo();
  fireEvent.click(screen.getByRole('button', { name: 'Saisie manuelle de la clé' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copier la clé' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCDEFGHIJKLMNOP'));
});

test('rule 40: the dialog is 480 px wide at most', () => {
  window.matchMedia = media({ coarse: false });
  renderStepTwo();
  const paper = screen.getByRole('dialog');
  expect(getComputedStyle(paper).maxWidth).toBe('480px');
});

test('rule 41: « Copier la clé » copies the key without its spaces', async () => {
  window.matchMedia = media({ coarse: true });
  const writeText = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderStepTwo();
  fireEvent.click(screen.getByRole('button', { name: 'Copier la clé' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCDEFGHIJKLMNOP'));
  expect(await screen.findByRole('button', { name: 'Clé copiée' })).toBeInTheDocument();
});

test('rule 41: the code field keeps the one-time-code autofill and the numeric keypad (rule 52)', () => {
  window.matchMedia = media({ coarse: true });
  renderStepTwo();
  const field = screen.getByLabelText('Code à 6 chiffres');
  expect(field.getAttribute('autocomplete')).toBe('one-time-code');
  expect(field.getAttribute('inputmode')).toBe('numeric');
});

test('rule 52: on a phone the dialog is full screen with its actions at the bottom', () => {
  window.matchMedia = media({ coarse: true, phone: true });
  renderStepTwo();
  const dialog = screen.getByRole('dialog');
  expect(dialog.closest('.MuiDialog-paperFullScreen')).not.toBeNull();
  const actions = document.querySelector('.MuiDialogActions-root');
  expect(actions.contains(screen.getByRole('button', { name: 'Annuler' }))).toBe(true);
  expect(actions.nextElementSibling).toBeNull();
});
