// specs/email-history-rolling-window.md rule 8 — the history shows the time of a send as it was in
// Paris, worded by the server; a failure reads the server's French reason (specs/email-automation.md
// rule 15), never the transport's words.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({ __esModule: true, default: { getEmailHistory: vi.fn(), getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() } }));

import api from '../../api';
import EmailHistoryPage from '../EmailHistoryPage';

const ROW = {
  id: 1, templateId: 10, reservationId: 42, sentAt: '2026-10-18 00:11:00', sentAtLabel: '18/10/2026 02:11', templateName: 'J-2',
  recipientEmail: 'jane@s.com', status: 'failed', errorMessage: 'Missing credentials for "PLAIN"',
  errorLabel: 'Serveur d’envoi refusé : vérifier Paramètres › Emails.', renderedSubject: 'À samedi', renderedBody: 'Bonjour',
};

beforeEach(() => {
  api.getEmailTemplates.mockResolvedValue([{ id: 10, name: 'J-2' }]);
  api.getEmailHistory.mockResolvedValue({ rows: [ROW], total: 1 });
});

test('rule 8: the Paris time of the server, and the failure in French', async () => {
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  expect((await screen.findAllByText('18/10/2026 02:11')).length).toBeGreaterThan(0);
  await userEvent.setup().click(screen.getAllByRole('button', { name: "Voir l'email" })[0]);
  expect(await screen.findByText(/Serveur d’envoi refusé/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Missing credentials/);
});
