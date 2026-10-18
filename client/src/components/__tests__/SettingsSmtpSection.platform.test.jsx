/**
 * SettingsSmtpSection on a hosted instance — specs/hosting-h1-fleet-runtime.md rule 19: « Envoi par
 * la plateforme » with where the replies go, the SMTP fields folded behind « Utiliser mon propre
 * serveur »; a saved host of its own wins and shows « Serveur personnel », unfolded. Without the
 * platform (Solio) the card is the SMTP form as before.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsSmtpSection from '../SettingsSmtpSection';

const base = {
  host: '', secure: false, username: '', passwordSet: false, fromEmail: '', fromName: '',
  derived: { fromEmail: 'claire@aulnes.fr', username: 'claire@aulnes.fr', fromName: 'Gîte des Aulnes' },
};
const draw = (values) => render(<SettingsSmtpSection values={values} onChange={vi.fn()} onChangePassword={vi.fn()} onSendTest={vi.fn()} />);

test('rule 19 — no SMTP of its own: « Envoi par la plateforme », replies to the company, the form folded', async () => {
  draw({ ...base, platform: { available: true, active: true, replyTo: 'claire@aulnes.fr' } });
  expect(screen.getByText('Envoi par la plateforme')).toBeInTheDocument();
  expect(screen.getByText('Les réponses arrivent à claire@aulnes.fr.')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: /Utiliser mon propre serveur/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('Serveur d’envoi')).toBeVisible();
});

test('rule 19 — a saved SMTP of its own wins: « Serveur personnel », unfolded', () => {
  draw({ ...base, host: 'smtp.aulnes.fr', passwordSet: true, platform: { available: true, active: false, replyTo: 'claire@aulnes.fr' } });
  expect(screen.getByText('Serveur personnel')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Utiliser mon propre serveur/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByText('Envoi par la plateforme')).not.toBeInTheDocument();
});

test('rule 19 — without the platform the card is the SMTP form, as before', () => {
  draw({ ...base, platform: { available: false, active: false, replyTo: '' } });
  expect(screen.getByText('Le serveur qui envoie les emails de GuestFlow.')).toBeInTheDocument();
  expect(screen.getByLabelText('Serveur d’envoi')).toBeVisible();
  expect(screen.queryByText('Utiliser mon propre serveur')).not.toBeInTheDocument();
});
