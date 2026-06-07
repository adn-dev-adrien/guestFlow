/**
 * EmailManualSendDialog — preview + send a template against a reservation.
 * See specs/email-automation.md §6.4.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

const TEMPLATES = [
  { id: 10, name: 'J-7', dayOffset: -7, sendMode: 'manual', enabled: 1 },
  { id: 11, name: 'J-1', dayOffset: -1, sendMode: 'auto',   enabled: 1 },
];

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue(TEMPLATES);
  api.previewEmail.mockResolvedValue({
    to: 'jane@s.com',
    subject: 'Préparation de votre séjour à Villa A',
    body: 'Bonjour Jane,\n\nNous préparons votre séjour…',
    missingVariables: [],
  });
});

test('loads templates + preview, shows the recipient', async () => {
  render(<EmailManualSendDialog open reservationId={100} reservationStartDate="2026-07-10" onClose={() => {}} />);
  await waitFor(() => expect(api.previewEmail).toHaveBeenCalled());
  // The dialog title surfaces the recipient.
  expect(await screen.findByText(/Destinataire : jane@s\.com/)).toBeInTheDocument();
  // Subject + body in editable text areas.
  expect(await screen.findByDisplayValue('Préparation de votre séjour à Villa A')).toBeInTheDocument();
});

test('Send calls api.sendEmail with the live subject + body as overrides', async () => {
  const user = userEvent.setup();
  api.sendEmail.mockResolvedValue({ ok: true, emailLogId: 1, sentAt: '2026-07-03 08:00:00' });
  render(<EmailManualSendDialog open reservationId={100} reservationStartDate="2026-07-10" onClose={() => {}} />);
  await screen.findByDisplayValue('Préparation de votre séjour à Villa A');

  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());

  const call = api.sendEmail.mock.calls[0][0];
  expect(call.reservationId).toBe(100);
  expect(call.overrides.subject).toBe('Préparation de votre séjour à Villa A');
  expect(call.overrides.body).toContain('Bonjour Jane,');
});

test('shows the missing variables warning when the renderer flags some', async () => {
  api.previewEmail.mockResolvedValue({
    to: 'jane@s.com',
    subject: 'S',
    body: 'B',
    missingVariables: ['accessCode', 'parkingSpot'],
  });
  render(<EmailManualSendDialog open reservationId={100} reservationStartDate="2026-07-10" onClose={() => {}} />);
  expect(await screen.findByText(/Variables non résolues/)).toBeInTheDocument();
  expect(screen.getByText('{{accessCode}}')).toBeInTheDocument();
  expect(screen.getByText('{{parkingSpot}}')).toBeInTheDocument();
});

test('Send is disabled when the recipient is empty', async () => {
  api.previewEmail.mockResolvedValue({ to: '', subject: 'S', body: 'B', missingVariables: [] });
  render(<EmailManualSendDialog open reservationId={100} reservationStartDate="2026-07-10" onClose={() => {}} />);
  await screen.findByDisplayValue('S');
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeDisabled();
});

test('EMAIL_NOT_CONFIGURED surfaces a recognisable error', async () => {
  const user = userEvent.setup();
  api.sendEmail.mockRejectedValue(new Error('EMAIL_NOT_CONFIGURED'));
  render(<EmailManualSendDialog open reservationId={100} reservationStartDate="2026-07-10" onClose={() => {}} />);
  await screen.findByDisplayValue('Préparation de votre séjour à Villa A');
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  expect(await screen.findByText(/SMTP non configuré/)).toBeInTheDocument();
});
