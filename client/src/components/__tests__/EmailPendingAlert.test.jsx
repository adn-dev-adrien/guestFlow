/**
 * EmailPendingAlert — the manual-email queue as a subject of the home (specs/email-automation.md §6.2
 * + §6.10). Its count and « N messages à envoyer · M clients sans adresse » are the server's
 * (specs/shell-and-home-day-first.md rule 6, tested server-side); the card draws them and leads to
 * the Emails page.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('react-router', () => ({
  __esModule: true,
  useNavigate: () => navigate,
}));

import EmailPendingAlert from '../EmailPendingAlert';

const attention = { key: 'email-pending', severity: 'info', count: 2, title: 'Emails à vérifier', detail: '2 messages à envoyer · 1 client sans adresse' };

beforeEach(() => navigate.mockReset());

test('renders nothing without a subject (the queue is empty)', () => {
  const { container } = render(<EmailPendingAlert attention={null} />);
  expect(container.firstChild).toBeNull();
});

test('renders the server count and detail, clients without an address included', () => {
  render(<EmailPendingAlert attention={attention} />);
  expect(screen.getByText('Emails à vérifier')).toBeInTheDocument();
  expect(screen.getByTestId('attention-count')).toHaveTextContent('2');
  expect(screen.getByText('2 messages à envoyer · 1 client sans adresse')).toBeInTheDocument();
});

test('« Voir et envoyer » navigates to the Emails page', async () => {
  const user = userEvent.setup();
  render(<EmailPendingAlert attention={attention} />);
  await user.click(screen.getByRole('button', { name: 'Voir et envoyer' }));
  expect(navigate).toHaveBeenCalledWith('/emails');
});
