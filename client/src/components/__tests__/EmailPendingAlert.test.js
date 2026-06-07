/**
 * EmailPendingAlert — dashboard widget that surfaces the manual-email queue.
 * See specs/email-automation.md §6.2.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPendingEmails: vi.fn(),
    getEmailTemplates: vi.fn(),
    acknowledgePendingEmail: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

vi.mock('../DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(),
  }),
}));

import api from '../../api';
import EmailPendingAlert from '../EmailPendingAlert';

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
});

test('renders nothing while the API call is pending', () => {
  api.getPendingEmails.mockReturnValue(new Promise(() => {})); // never resolves
  const { container } = render(<EmailPendingAlert />);
  expect(container.firstChild).toBeNull();
});

test('renders nothing when the pending list is empty', async () => {
  api.getPendingEmails.mockResolvedValue([]);
  const { container } = render(<EmailPendingAlert />);
  await waitFor(() => expect(api.getPendingEmails).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('renders the alert card with the pending count when > 0', async () => {
  api.getPendingEmails.mockResolvedValue([
    { templateId: 1, reservationId: 100, templateName: 'J-7', clientFullName: 'Jane S.', clientEmail: 'jane@s.com', propertyName: 'Villa A', startDate: '2026-06-17' },
    { templateId: 1, reservationId: 101, templateName: 'J-7', clientFullName: 'Marc P.', clientEmail: 'marc@p.fr', propertyName: 'Le Gîte', startDate: '2026-06-18' },
  ]);
  render(<EmailPendingAlert />);
  expect(await screen.findByText('Emails à vérifier (2)')).toBeInTheDocument();
  expect(screen.getByText(/2 messages? en attente/i)).toBeInTheDocument();
});

test('mentions the number of clients without an email address', async () => {
  api.getPendingEmails.mockResolvedValue([
    { templateId: 1, reservationId: 100, templateName: 'J-7', clientFullName: 'Jane', clientEmail: 'jane@s.com', propertyName: 'A', startDate: '2026-06-17' },
    { templateId: 1, reservationId: 101, templateName: 'J-7', clientFullName: 'Marc', clientEmail: '',           propertyName: 'B', startDate: '2026-06-18' },
  ]);
  render(<EmailPendingAlert />);
  expect(await screen.findByText(/1 client sans adresse email/i)).toBeInTheDocument();
});

test('clicking the card opens the pending dialog', async () => {
  const user = userEvent.setup();
  api.getPendingEmails.mockResolvedValue([
    { templateId: 1, reservationId: 100, templateName: 'J-7', clientFullName: 'Jane', clientEmail: 'jane@s.com', propertyName: 'A', startDate: '2026-06-17' },
  ]);
  api.getEmailTemplates.mockResolvedValue([]); // dialog re-fetches via EmailPendingDialog
  render(<EmailPendingAlert />);
  await screen.findByText('Emails à vérifier (1)');
  await user.click(screen.getByText('Voir et envoyer'));
  // The dialog mounts and re-queries the pending list inside it.
  expect(await screen.findByText('Emails en attente d\'envoi')).toBeInTheDocument();
});
