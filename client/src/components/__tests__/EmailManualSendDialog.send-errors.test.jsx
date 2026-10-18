// specs/email-automation.md rule 15 — a failed send says what happened in French, next to the
// buttons: never a bare code (« EMAIL_SEND_FAILED ») nor the transport's own words. The « déjà
// envoyé » date is the server's Paris time (specs/email-history-rolling-window.md rule 8).
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
import { sendErrorMessage, SEND_FALLBACK } from '../../constants/emailSendErrors';

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplates.mockResolvedValue([{ id: 20, name: 'Séquence — J-2', dayOffset: -2, whenLabel: 'J-2', enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'camille@example.fr', subject: 'À samedi', body: 'Bonjour Camille', missingVariables: [] });
});

async function sendWith(error) {
  api.sendEmail.mockRejectedValue(error);
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('À samedi');
  await userEvent.setup().click(screen.getByRole('button', { name: /^Envoyer$/ }));
  return screen.findByRole('alert');
}

test('rule 15: the server\'s French reason is shown, the code never', async () => {
  const alert = await sendWith(Object.assign(new Error('Envoi refusé : limite quotidienne atteinte.'), { error: 'EMAIL_SEND_FAILED' }));
  expect(alert).toHaveTextContent('Envoi refusé : limite quotidienne atteinte.');
  expect(document.body.textContent).not.toMatch(/EMAIL_SEND_FAILED/);
});

test('rule 15: a bare code becomes a sentence', async () => {
  const alert = await sendWith(Object.assign(new Error('EMAIL_SEND_FAILED'), { error: 'EMAIL_SEND_FAILED' }));
  expect(alert).toHaveTextContent(SEND_FALLBACK);
  expect(sendErrorMessage({ error: 'CLIENT_NO_EMAIL', message: 'CLIENT_NO_EMAIL' })).toBe('Adresse destinataire manquante.');
});

test('rule 15: the template list reads the server\'s « Quand »', async () => {
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  expect(await screen.findByText('Séquence — J-2 (J-2)')).toBeInTheDocument();
});

test('specs/email-history-rolling-window.md rule 8: « déjà envoyé » shows the server\'s Paris time', async () => {
  api.sendEmail.mockRejectedValue(Object.assign(new Error('ALREADY_SENT'), { error: 'ALREADY_SENT', sentAt: '2026-10-18 00:11:00', sentAtLabel: '18/10/2026 02:11' }));
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={20} onClose={() => {}} />);
  await screen.findByDisplayValue('À samedi');
  await userEvent.setup().click(screen.getByRole('button', { name: /^Envoyer$/ }));
  expect(await screen.findByText('Ce mail a déjà été envoyé le 18/10/2026 02:11. Le renvoyer quand même ?')).toBeInTheDocument();
});
