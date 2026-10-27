// specs/direct-installments.md rule 19 — the « à valider » list holds one entry per installment of the same
// reservation and template, each named by its number and handed to the actions with its own key.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import EmailPendingList from '../EmailPendingList';

const row = (number) => ({
  templateId: 9, reservationId: 100, templateName: 'Demande de règlement d\'une échéance', clientFullName: 'Camille Martin',
  clientEmail: 'camille@example.com', propertyName: 'La Granja', startDate: '2027-06-14',
  occurrenceKey: `installment:${40 + number}`, installmentNumber: number,
});

test('two installments of one stay are two rows, named by number, and each action carries its own entry', async () => {
  const user = userEvent.setup();
  const onPreview = vi.fn();
  render(<EmailPendingList rows={[row(1), row(2)]} onPreview={onPreview} onOpenReservation={vi.fn()} onAcknowledge={vi.fn()} />);
  expect(screen.getByText('Échéance 1')).toBeInTheDocument();
  expect(screen.getByText('Échéance 2')).toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: 'Envoyer' })[1]);
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ occurrenceKey: 'installment:42', installmentNumber: 2 }));
});
