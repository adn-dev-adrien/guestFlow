// specs/email-history-rolling-window.md rule 10 (2026-10-27 spec review) — at phone width the history
// is a list of cards carrying the e-mail, the recipient and the status, not a clipped 6-column table.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';
import { setViewport, resetViewport } from '../../components/__tests__/viewportFixture';

vi.mock('../../api', () => ({ __esModule: true, default: { getEmailHistory: vi.fn(), getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() } }));

import api from '../../api';
import EmailHistoryPage from '../EmailHistoryPage';

const ROW = {
  id: 1, templateId: 10, reservationId: 42, sentAt: '2026-10-18 00:11:00', sentAtLabel: '18/10/2026 02:11',
  templateName: 'Merci et avis', clientFullName: 'Jane Smith', propertyName: 'La Granja',
  recipientEmail: 'jane.smith.with.a.very.long.address@example.com', status: 'sent', channel: 'smtp',
  renderedSubject: 'Merci pour votre séjour', renderedBody: 'Bonjour',
};

beforeEach(() => {
  api.getEmailTemplates.mockResolvedValue([{ id: 10, name: 'Séquence — J+1 merci et avis', displayName: 'Merci et avis' }]);
  api.getEmailHistory.mockResolvedValue({ rows: [ROW], total: 1 });
});
afterEach(resetViewport);

test('at 390 px each e-mail is a card with its recipient, its status and its actions — no table', async () => {
  setViewport(390);
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  expect(await screen.findByText('jane.smith.with.a.very.long.address@example.com')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('Envoyé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Renvoyer cet email' })).toBeInTheDocument();
});

test('on a desktop it stays a table', async () => {
  setViewport(1280);
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
