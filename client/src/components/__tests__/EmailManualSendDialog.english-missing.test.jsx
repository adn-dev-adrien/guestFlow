/**
 * EmailManualSendDialog — a template with no English version, for an English-speaking guest
 * (specs/email-language-fr-en.md rule 9, operator decision of 2026-10-27): the dialog says so and
 * refuses to send; the template list marks it.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue([
    { id: 20, name: 'Mot perso', displayName: 'Mot perso', whenLabel: 'À la demande', dayOffset: 0, enabled: 1, hasEnglish: false },
    { id: 21, name: 'Confirmation', displayName: 'Confirmation', whenLabel: 'À la réservation', dayOffset: 0, enabled: 1, hasEnglish: true },
  ]);
  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'Sujet FR', body: 'Corps FR', missingVariables: [], lang: 'en', englishMissing: true,
  });
});

test('the dialog says the English version is missing and keeps « Envoyer » disabled', async () => {
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('Sujet FR');
  expect(screen.getByRole('alert')).toHaveTextContent('Version anglaise manquante pour ce modèle : la rédiger dans Emails › Modèles, ou passer le mail en français.');
  expect(screen.getByRole('button', { name: /Envoyer/ })).toBeDisabled();
  expect(api.sendEmail).not.toHaveBeenCalled();
});

test('the template list marks the templates an English-speaking guest cannot receive', async () => {
  const user = userEvent.setup();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('Sujet FR');
  await user.click(screen.getByRole('combobox'));
  expect(screen.getByRole('option', { name: /Mot perso.*version anglaise manquante/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^Confirmation \(À la réservation\)$/ })).toBeInTheDocument();
});

test('a template with its English version sends as before', async () => {
  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'See you soon', body: 'Hello', missingVariables: [], lang: 'en', englishMissing: false,
  });
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={21} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Envoyer/ })).toBeEnabled();
});
