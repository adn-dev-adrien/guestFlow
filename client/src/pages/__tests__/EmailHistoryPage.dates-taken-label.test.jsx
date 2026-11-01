// specs/payment-link-lifecycle.md rule 44 — the guest notice sent without validation reads, in the history, the
// server's « Envoyé automatiquement (dates prises) »; any other send keeps « Envoyé ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({ __esModule: true, default: { getEmailHistory: vi.fn(), getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() } }));

import api from '../../api';
import EmailHistoryPage from '../EmailHistoryPage';

const base = { reservationId: 42, sentAt: '2026-10-18 00:11:00', sentAtLabel: '18/10/2026 02:11', recipientEmail: 'jane@example.test', status: 'sent', channel: 'smtp', renderedBody: 'Bonjour' };

test('rule 44 — the notice is labelled by the server, the others are « Envoyé »', async () => {
  api.getEmailTemplates.mockResolvedValue([{ id: 10, name: 'Dates plus disponibles' }, { id: 11, name: 'Accès et arrivée' }]);
  api.getEmailHistory.mockResolvedValue({ total: 2, rows: [
    { ...base, id: 1, templateId: 10, templateName: 'Dates plus disponibles', renderedSubject: 'Vos dates', statusLabel: 'Envoyé automatiquement (dates prises)' },
    { ...base, id: 2, templateId: 11, templateName: 'Accès et arrivée', renderedSubject: 'À samedi' },
  ] });
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  expect((await screen.findAllByText('Envoyé automatiquement (dates prises)')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Envoyé').length).toBeGreaterThan(0);
});
