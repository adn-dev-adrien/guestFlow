/**
 * specs/email-history-rolling-window.md rule 11 — a failed load shows an error with « Réessayer » (no
 * false empty list, no unhandled rejection), and a late response never replaces the current filter.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailHistory: vi.fn(), getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import DialogProvider from '../../components/DialogProvider';
import EmailHistoryPage from '../EmailHistoryPage';

const ROW = {
  id: 1, templateId: 10, reservationId: 22303, sentAt: '2026-07-03 08:00:00', templateName: 'J-7',
  recipientEmail: 'jane@s.com', status: 'sent', renderedSubject: 'Sujet', renderedBody: 'Bonjour',
};

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getEmailTemplates.mockResolvedValue([]);
});

const renderPage = () => render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);

test('rule 11 — a failed load shows an error, not « Aucun email », and « Réessayer » recovers', async () => {
  api.getEmailHistory.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [ROW], total: 1 });
  renderPage();
  expect(await screen.findByText("Impossible de charger l'historique des emails.")).toBeInTheDocument();
  expect(screen.queryByText("Aucun email dans l'historique")).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('jane@s.com')).toBeInTheDocument();
});

test('rule 11 — a late response of an older filter does not overwrite the current list', async () => {
  let resolveStale;
  api.getEmailHistory.mockImplementation((params) => {
    if (params.reservationId === '2') return new Promise((resolve) => { resolveStale = resolve; });
    if (params.reservationId === '22') return Promise.resolve({ rows: [ROW], total: 1 });
    return Promise.resolve({ rows: [], total: 0 });
  });
  renderPage();
  await waitFor(() => expect(api.getEmailHistory).toHaveBeenCalled());
  const field = screen.getByLabelText('Réservation #');
  await userEvent.type(field, '2');
  await userEvent.type(field, '2');
  expect(await screen.findByText('jane@s.com')).toBeInTheDocument();
  await act(async () => { resolveStale({ rows: [], total: 0 }); });
  expect(screen.getByText('jane@s.com')).toBeInTheDocument();
  expect(screen.queryByText("Aucun email dans l'historique")).toBeNull();
});

test('rule 11 — a superseded request that fails does not raise the error', async () => {
  let rejectStale;
  api.getEmailHistory.mockImplementation((params) => {
    if (params.reservationId === '2') return new Promise((_, reject) => { rejectStale = reject; });
    if (params.reservationId === '22') return Promise.resolve({ rows: [ROW], total: 1 });
    return Promise.resolve({ rows: [], total: 0 });
  });
  renderPage();
  await waitFor(() => expect(api.getEmailHistory).toHaveBeenCalled());
  const field = screen.getByLabelText('Réservation #');
  await userEvent.type(field, '22');
  expect(await screen.findByText('jane@s.com')).toBeInTheDocument();
  await act(async () => { rejectStale(new Error('late')); });
  expect(screen.queryByText("Impossible de charger l'historique des emails.")).toBeNull();
});
