/**
 * EmailManualSendDialog — the language a message will leave in
 * (specs/site-english-version.md rules 20-21).
 *
 * The dialog must answer, before anything is sent, a question the operator could previously only
 * answer by opening the guest's record: which language is this going out in? And it must let them
 * write one message in the other language without changing what the guest is on file as.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    { id: 20, name: 'Confirmation', dayOffset: 0, sendMode: 'manual', enabled: 1 },
  ]);
  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'See you soon', body: 'Hello Ada', missingVariables: [], lang: 'en',
  });
  api.sendEmail.mockResolvedValue({ ok: true, emailLogId: 1 });
});

test('the dialog shows the language the server resolved for this guest', async () => {
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');
  expect(screen.getByText('EN')).toBeInTheDocument();
});

test('a French guest is announced as French', async () => {
  api.previewEmail.mockResolvedValue({
    to: 'jean@example.fr', subject: 'À bientôt', body: 'Bonjour Jean', missingVariables: [], lang: 'fr',
  });
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('À bientôt');
  expect(screen.getByText('FR')).toBeInTheDocument();
});

test('the first preview asks for no language, so the server resolves the guest’s own', async () => {
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');
  expect(api.previewEmail.mock.calls[0][0].lang).toBeUndefined();
});

test('flipping the language re-previews in the other one', async () => {
  const user = userEvent.setup();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');

  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'À bientôt', body: 'Bonjour Ada', missingVariables: [], lang: 'fr',
  });
  await user.click(screen.getByRole('button', { name: /Passer en FR/ }));

  await waitFor(() => expect(api.previewEmail).toHaveBeenCalledTimes(2));
  expect(api.previewEmail.mock.calls[1][0].lang).toBe('fr');
  expect(await screen.findByDisplayValue('À bientôt')).toBeInTheDocument();
});

test('the override rides the send, and only the send', async () => {
  const user = userEvent.setup();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');

  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'À bientôt', body: 'Bonjour Ada', missingVariables: [], lang: 'fr',
  });
  await user.click(screen.getByRole('button', { name: /Passer en FR/ }));
  await screen.findByDisplayValue('À bientôt');

  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  const payload = api.sendEmail.mock.calls[0][0];
  expect(payload.lang).toBe('fr');
  // Rule 20: nothing in the payload touches the guest's stored preference.
  expect(JSON.stringify(payload)).not.toContain('emailLanguage');
});

test('without an override the send carries no language, so the guest’s own applies', async () => {
  const user = userEvent.setup();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('See you soon');

  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  expect(api.sendEmail.mock.calls[0][0].lang).toBeUndefined();
});

test('reopening the dialog forgets the override', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />
  );
  await screen.findByDisplayValue('See you soon');
  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'À bientôt', body: 'Bonjour Ada', missingVariables: [], lang: 'fr',
  });
  await user.click(screen.getByRole('button', { name: /Passer en FR/ }));
  await screen.findByDisplayValue('À bientôt');

  rerender(<EmailManualSendDialog open={false} reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  api.previewEmail.mockResolvedValue({
    to: 'ada@example.com', subject: 'See you soon', body: 'Hello Ada', missingVariables: [], lang: 'en',
  });
  rerender(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);

  await screen.findByDisplayValue('See you soon');
  expect(screen.getByText('EN')).toBeInTheDocument();
});
