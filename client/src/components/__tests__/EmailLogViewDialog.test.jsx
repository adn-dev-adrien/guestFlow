/**
 * EmailLogViewDialog — read-only preview of an email_log row.
 * See specs/email-automation.md §6.5.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import EmailLogViewDialog from '../EmailLogViewDialog';

const BASE_ROW = {
  id: 1,
  templateName: 'J-7',
  recipientEmail: 'jane@s.com',
  renderedSubject: 'Préparation de votre séjour',
  renderedBody: 'Bonjour Jane,\n\nVotre séjour…',
  status: 'sent',
  errorMessage: '',
};

test('renders the rendered subject + body + sent badge', () => {
  render(<EmailLogViewDialog open row={BASE_ROW} onClose={() => {}} />);
  expect(screen.getByText('Préparation de votre séjour')).toBeInTheDocument();
  expect(screen.getByText(/Bonjour Jane,/)).toBeInTheDocument();
  expect(screen.getByText('Envoyé')).toBeInTheDocument();
});

test('shows the error message when status=failed', () => {
  render(<EmailLogViewDialog open row={{ ...BASE_ROW, status: 'failed', errorMessage: 'connection refused' }} onClose={() => {}} />);
  expect(screen.getByText('Échec')).toBeInTheDocument();
  expect(screen.getByText(/connection refused/)).toBeInTheDocument();
});

test('returns null when no row is provided', () => {
  const { container } = render(<EmailLogViewDialog open row={null} onClose={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test('acknowledged-skip renders the "Ignoré" badge', () => {
  render(<EmailLogViewDialog open row={{ ...BASE_ROW, status: 'acknowledged-skip' }} onClose={() => {}} />);
  expect(screen.getByText('Ignoré')).toBeInTheDocument();
});
