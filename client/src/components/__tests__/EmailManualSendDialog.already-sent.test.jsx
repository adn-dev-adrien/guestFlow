/**
 * EmailManualSendDialog — a guest-sequence email already sent is re-sent only after an explicit
 * confirmation (specs/guest-email-sequence.md rule 13bis).
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
  api.getEmailTemplates.mockResolvedValue([{ id: 20, name: 'Séquence — J-2 arrivée', dayOffset: -2, sendMode: 'auto', enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'camille@example.fr', subject: 'À samedi, à La Granja', body: 'Bonjour Camille', missingVariables: [] });
});

test('409 ALREADY_SENT asks before resending, then resends with confirmResend', async () => {
  const user = userEvent.setup();
  api.sendEmail
    .mockRejectedValueOnce(Object.assign(new Error('ALREADY_SENT'), { error: 'ALREADY_SENT', sentAt: '2026-07-08 08:00:00' }))
    .mockResolvedValueOnce({ ok: true, emailLogId: 7 });
  const onSent = vi.fn();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} onSent={onSent} />);
  await screen.findByDisplayValue('À samedi, à La Granja');

  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  expect(await screen.findByText(/Ce mail a déjà été envoyé le/)).toBeInTheDocument();
  expect(api.sendEmail).toHaveBeenCalledTimes(1);
  expect(api.sendEmail.mock.calls[0][0].confirmResend).toBe(false);

  await user.click(screen.getByRole('button', { name: 'Renvoyer' }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalledTimes(2));
  expect(api.sendEmail.mock.calls[1][0].confirmResend).toBe(true);
  await waitFor(() => expect(onSent).toHaveBeenCalled());
});

test('cancelling the confirmation sends nothing more', async () => {
  const user = userEvent.setup();
  api.sendEmail.mockRejectedValueOnce(Object.assign(new Error('ALREADY_SENT'), { error: 'ALREADY_SENT', sentAt: '2026-07-08 08:00:00' }));
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('À samedi, à La Granja');
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await screen.findByText(/Ce mail a déjà été envoyé le/);
  // The confirmation opens over the send dialog: its « Annuler » is the last one rendered.
  await user.click(screen.getAllByRole('button', { name: 'Annuler' }).at(-1));
  await waitFor(() => expect(screen.queryByText(/Ce mail a déjà été envoyé le/)).not.toBeInTheDocument());
  expect(api.sendEmail).toHaveBeenCalledTimes(1);
});
