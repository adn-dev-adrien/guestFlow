/**
 * ClientFormFields — the operator's « pas de mails après séjour » switch and the guest's own
 * unsubscribe, read-only (specs/guest-email-sequence.md rules 9-10).
 */

import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({ __esModule: true, default: { parseClientContact: vi.fn() } }));

import ClientFormFields from '../ClientFormFields';

const CLIENT = {
  lastName: 'Martin', firstName: 'Camille', streetNumber: '', street: '', postalCode: '', city: '',
  address: '', phone: '', email: 'camille@example.fr', notes: '', emailLanguage: 'fr', postStayEmailsDisabled: 0,
};

function Harness({ initial, onFormChange }) {
  const [form, setForm] = useState(initial);
  onFormChange(form);
  return <ClientFormFields form={form} setForm={setForm} cityOptions={[]} />;
}

test('the switch writes postStayEmailsDisabled as 0/1', async () => {
  const user = userEvent.setup();
  let latest;
  render(<Harness initial={CLIENT} onFormChange={(f) => { latest = f; }} />);
  const toggle = screen.getByRole('switch', { name: 'Ne pas envoyer les mails après séjour' });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);
  expect(latest.postStayEmailsDisabled).toBe(1);
  await user.click(toggle);
  expect(latest.postStayEmailsDisabled).toBe(0);
});

test('a guest who unsubscribed is shown, with the date', () => {
  render(<Harness initial={{ ...CLIENT, marketingUnsubscribedAt: '2026-11-20 09:12:00' }} onFormChange={() => {}} />);
  expect(screen.getByText('Désinscrit des nouvelles le 20/11/2026')).toBeInTheDocument();
});

test('no badge when the guest never unsubscribed', () => {
  render(<Harness initial={CLIENT} onFormChange={() => {}} />);
  expect(screen.queryByText(/Désinscrit des nouvelles/)).not.toBeInTheDocument();
});
