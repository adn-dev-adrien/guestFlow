/**
 * EmailPendingList — inline queue table on the Emails page.
 * See specs/email-automation.md §6.3 + §6.10.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EmailPendingList from '../EmailPendingList';

const ROWS = [
  { templateId: 1, reservationId: 100, templateName: 'J-7', clientFullName: 'Jane S.', clientEmail: 'jane@s.com', propertyName: 'Villa A', startDate: '2026-07-10' },
  { templateId: 2, reservationId: 101, templateName: 'J-1', clientFullName: 'Marc P.', clientEmail: '',           propertyName: 'Le Gîte', startDate: '2026-07-11' },
];

function setup(rows = ROWS) {
  const onPreview = vi.fn();
  const onOpenReservation = vi.fn();
  const onAcknowledge = vi.fn();
  render(
    <EmailPendingList
      rows={rows}
      onPreview={onPreview}
      onOpenReservation={onOpenReservation}
      onAcknowledge={onAcknowledge}
    />,
  );
  return { onPreview, onOpenReservation, onAcknowledge };
}

test('renders one row per pending email with client + property + template', () => {
  setup();
  expect(screen.getByText('Jane S.')).toBeInTheDocument();
  expect(screen.getByText('Villa A')).toBeInTheDocument();
  expect(screen.getByText('J-7')).toBeInTheDocument();
  expect(screen.getByText('Marc P.')).toBeInTheDocument();
});

test('renders no data rows when the queue is empty', () => {
  setup([]);
  expect(screen.queryByText('Ignorer')).not.toBeInTheDocument();
});

test('flags a missing email address with a chip', () => {
  setup();
  expect(screen.getByText('Adresse manquante')).toBeInTheDocument();
});

test('clicking a row with an email fires onPreview with that row', async () => {
  const user = userEvent.setup();
  const { onPreview } = setup();
  await user.click(screen.getByText('Villa A')); // a non-interactive cell in Jane's row
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(onPreview).toHaveBeenCalledWith(ROWS[0]);
});

test('a row without an email is still clickable and fires onPreview', async () => {
  const user = userEvent.setup();
  const { onPreview } = setup();
  await user.click(screen.getByText('Le Gîte')); // Marc's row, no email
  expect(onPreview).toHaveBeenCalledWith(ROWS[1]);
});

test('clicking the client name opens the reservation, not the preview', async () => {
  const user = userEvent.setup();
  const { onPreview, onOpenReservation } = setup();
  await user.click(screen.getByText('Jane S.'));
  expect(onOpenReservation).toHaveBeenCalledWith(ROWS[0]);
  expect(onPreview).not.toHaveBeenCalled();
});

test('"Ignorer" fires onAcknowledge without triggering the row preview', async () => {
  const user = userEvent.setup();
  const { onAcknowledge, onPreview } = setup();
  await user.click(screen.getAllByRole('button', { name: 'Ignorer' })[0]);
  expect(onAcknowledge).toHaveBeenCalledWith(ROWS[0]);
  expect(onPreview).not.toHaveBeenCalled();
});
