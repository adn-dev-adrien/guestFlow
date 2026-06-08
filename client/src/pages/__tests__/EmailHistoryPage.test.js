/**
 * EmailHistoryPage — paginated log of sends / failures / acknowledged-skips with filters.
 * See specs/email-automation.md §6.5.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailHistory: vi.fn(),
    getEmailTemplates: vi.fn(),
  },
}));

import api from '../../api';
import EmailHistoryPage from '../EmailHistoryPage';

const ROW = {
  id: 1,
  sentAt: '2026-07-03 08:00:00',
  templateName: 'J-7',
  clientFullName: 'Jane S.',
  propertyName: 'Villa A',
  recipientEmail: 'jane@s.com',
  status: 'sent',
  renderedSubject: 'Préparation de votre séjour',
  renderedBody: 'Bonjour Jane,',
};

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue([{ id: 10, name: 'J-7' }]);
  api.getEmailHistory.mockResolvedValue({ rows: [ROW], total: 1 });
});

test('loads the history and renders a row with its status badge + subject', async () => {
  render(<EmailHistoryPage />);
  await waitFor(() => expect(api.getEmailHistory).toHaveBeenCalled());
  expect(await screen.findByText('jane@s.com')).toBeInTheDocument();
  expect(screen.getByText('Envoyé')).toBeInTheDocument();
  expect(screen.getByText('Préparation de votre séjour')).toBeInTheDocument();
  expect(screen.getByText('Jane S. · Villa A')).toBeInTheDocument();
});

test('shows the empty message when there are no rows', async () => {
  api.getEmailHistory.mockResolvedValue({ rows: [], total: 0 });
  render(<EmailHistoryPage />);
  expect(await screen.findByText("Aucun email dans l'historique")).toBeInTheDocument();
});

test('changing the status filter re-queries with the status param and resets to page 0', async () => {
  const user = userEvent.setup();
  render(<EmailHistoryPage />);
  await screen.findByText('jane@s.com');

  // The status filter is the first of the two Selects (status, then template).
  await user.click(screen.getAllByRole('combobox')[0]);
  await user.click(await screen.findByRole('option', { name: 'Échec' }));

  await waitFor(() => {
    const last = api.getEmailHistory.mock.calls.at(-1)[0];
    expect(last.status).toBe('failed');
    expect(last.offset).toBe(0);
  });
});

test('the reservation # filter is forwarded to the API', async () => {
  const user = userEvent.setup();
  render(<EmailHistoryPage />);
  await screen.findByText('jane@s.com');

  await user.type(screen.getByLabelText('Réservation #'), '100');

  await waitFor(() => {
    const last = api.getEmailHistory.mock.calls.at(-1)[0];
    expect(last.reservationId).toBe('100');
  });
});

test('pagination buttons are disabled on a single page', async () => {
  render(<EmailHistoryPage />);
  await screen.findByText('jane@s.com');
  expect(screen.getByRole('button', { name: 'Précédent' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled();
});

test('"Suivant" advances the page and re-queries with the next offset', async () => {
  const user = userEvent.setup();
  api.getEmailHistory.mockResolvedValue({ rows: [ROW], total: 120 }); // 3 pages of 50
  render(<EmailHistoryPage />);
  await screen.findByText('jane@s.com');

  await user.click(screen.getByRole('button', { name: 'Suivant' }));

  await waitFor(() => {
    const last = api.getEmailHistory.mock.calls.at(-1)[0];
    expect(last.offset).toBe(50);
  });
});

test('clicking the view icon opens the log detail dialog', async () => {
  const user = userEvent.setup();
  render(<EmailHistoryPage />);
  const row = (await screen.findByText('jane@s.com')).closest('tr');
  await user.click(within(row).getByRole('button'));

  expect(await screen.findByText('Bonjour Jane,')).toBeInTheDocument();
});
