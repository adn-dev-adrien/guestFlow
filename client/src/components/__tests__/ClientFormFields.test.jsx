/**
 * ClientFormFields — the address block and the email/phone drop zones send their raw payload to the
 * server and render what comes back (specs/client-contact-smart-input.md). Nothing is parsed here, so
 * these tests assert the plumbing: what is sent, what is written back, and what happens on failure.
 */

import React, { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    parseClientContact: vi.fn(),
  },
}));

import api from '../../api';
import ClientFormFields from '../ClientFormFields';

const EMPTY_CLIENT = {
  lastName: '', firstName: '', streetNumber: '', street: '', postalCode: '', city: '',
  address: '', phone: '', email: '', notes: '', emailLanguage: 'fr',
};

// The three consumer pages all hold the form in a `useState`; mirror that here.
function Harness({ initial = EMPTY_CLIENT, onFormChange }) {
  const [form, setForm] = useState(initial);
  onFormChange?.(form);
  return <ClientFormFields form={form} setForm={setForm} cityOptions={[]} />;
}

// jsdom has no drag & drop; fire the events the component listens to with a stub DataTransfer.
function fireDrop(input, payload, { uriList = '' } = {}) {
  const dataTransfer = {
    getData: (type) => {
      if (type === 'text/uri-list') return uriList;
      if (type === 'text/plain') return payload;
      return '';
    },
  };
  const event = new Event('drop', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  input.dispatchEvent(event);
}

beforeEach(() => {
  api.parseClientContact.mockReset();
});

test('dropping a mailto link on Email sends the raw payload and writes the cleaned address', async () => {
  api.parseClientContact.mockResolvedValue({ email: 'jean.dupont@example.com' });
  render(<Harness />);

  const email = screen.getByLabelText('Email');
  fireDrop(email, 'mailto:Jean.Dupont@Example.com?subject=Contact');

  await waitFor(() => expect(email).toHaveValue('jean.dupont@example.com'));
  expect(api.parseClientContact).toHaveBeenCalledWith({ email: 'mailto:Jean.Dupont@Example.com?subject=Contact' });
});

test('dropping a tel link on Téléphone writes the number returned by the server', async () => {
  api.parseClientContact.mockResolvedValue({ phone: '0627753922' });
  render(<Harness />);

  const phone = screen.getByLabelText('Téléphone');
  fireDrop(phone, 'tel:+33627753922');

  await waitFor(() => expect(phone).toHaveValue('0627753922'));
  expect(api.parseClientContact).toHaveBeenCalledWith({ phone: 'tel:+33627753922' });
});

test('a dropped uri-list wins over the plain-text flavour', async () => {
  api.parseClientContact.mockResolvedValue({ email: 'a@b.fr' });
  render(<Harness />);

  fireDrop(screen.getByLabelText('Email'), 'Jean Dupont', { uriList: '# comment\nmailto:a@b.fr\n' });

  await waitFor(() => expect(api.parseClientContact).toHaveBeenCalledWith({ email: 'mailto:a@b.fr' }));
});

test('typing an address in the block and leaving it fills the four detail fields', async () => {
  const user = userEvent.setup();
  api.parseClientContact.mockResolvedValue({
    address: { streetNumber: '12', street: 'Rue des lilas', postalCode: '07000', city: 'Privas' },
  });
  render(<Harness />);

  const block = screen.getByLabelText('Adresse (saisie libre)');
  await user.type(block, '12 rue des Lilas 07000 Privas');
  await user.tab();

  await waitFor(() => expect(screen.getByLabelText('N°')).toHaveValue('12'));
  expect(api.parseClientContact).toHaveBeenCalledWith({ address: '12 rue des Lilas 07000 Privas' });
  expect(screen.getByLabelText('Rue / voie')).toHaveValue('Rue des lilas');
  expect(screen.getByLabelText('Code postal')).toHaveValue('07000');
  expect(screen.getByLabelText('Ville')).toHaveValue('Privas');
  // The block now mirrors the normalized fields.
  expect(block).toHaveValue('12 Rue des lilas 07000 Privas');
});

test('leaving the address block unchanged does not call the server', async () => {
  const user = userEvent.setup();
  render(<Harness initial={{ ...EMPTY_CLIENT, streetNumber: '12', street: 'Rue des lilas', postalCode: '07000', city: 'Privas' }} />);

  const block = screen.getByLabelText('Adresse (saisie libre)');
  expect(block).toHaveValue('12 Rue des lilas 07000 Privas');
  await user.click(block);
  await user.tab();

  expect(api.parseClientContact).not.toHaveBeenCalled();
});

test('the block recomposes itself when a detail field is edited by hand', async () => {
  const user = userEvent.setup();
  render(<Harness initial={{ ...EMPTY_CLIENT, streetNumber: '12', street: 'Rue des lilas', postalCode: '07000', city: 'Privas' }} />);

  await user.clear(screen.getByLabelText('Code postal'));
  await user.type(screen.getByLabelText('Code postal'), '07200');

  expect(screen.getByLabelText('Adresse (saisie libre)')).toHaveValue('12 Rue des lilas 07200 Privas');
  expect(api.parseClientContact).not.toHaveBeenCalled();
});

test('a failed parse leaves the field untouched and shows the error helper', async () => {
  api.parseClientContact.mockRejectedValue(new Error('offline'));
  render(<Harness initial={{ ...EMPTY_CLIENT, email: 'ancien@example.com' }} />);

  const email = screen.getByLabelText('Email');
  fireDrop(email, 'mailto:nouveau@example.com');

  await waitFor(() => expect(screen.getByText('Analyse impossible')).toBeInTheDocument());
  expect(email).toHaveValue('ancien@example.com');
});
