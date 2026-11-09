// specs/resource-booking-pricing-and-invoicing.md rules 2, 13, 17-19 — the invoice block renders the server's states.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import BookingInvoiceBlock from '../BookingInvoiceBlock';

vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const base = { qontoReady: true, offered: true, checked: true, onCheck: () => {}, billing: { street: '', postcode: '', city: '' }, onBilling: () => {}, cardDay: '09/11' };
const invoiced = (state, hasCard = true) => ({
  id: 1, payment: { hasCard, onTheBooks: true }, invoice: { number: 'F-2026-0142', cancelled: false, attachment: { state } },
});

test('rule 2 — Qonto not connected: the payment still goes, the invoice later', () => {
  render(<BookingInvoiceBlock {...base} qontoReady={false} />);
  expect(screen.getByText(/Facturation Qonto non connectée/)).toBeInTheDocument();
});

test('rule 13 — a caisse-interne payment offers no invoice', () => {
  render(<BookingInvoiceBlock {...base} internalCash />);
  expect(screen.getByText(/Caisse interne : hors comptabilité, pas de facture/)).toBeInTheDocument();
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
});

test('rule 13 — a payment on the books offers « Créer la facture dans Qonto » with the optional address', () => {
  render(<BookingInvoiceBlock {...base} />);
  expect(screen.getByText('Créer la facture dans Qonto')).toBeInTheDocument();
  expect(screen.getByText('Adresse de facturation · facultative')).toBeInTheDocument();
});

test('rules 17-19 — pending, attached and failed attachments each say what they are', () => {
  const { rerender } = render(<BookingInvoiceBlock {...base} booking={invoiced('pending')} />);
  expect(screen.getByText(/En attente du lot CB du 09\/11/)).toBeInTheDocument();
  rerender(<BookingInvoiceBlock {...base} booking={invoiced('attached')} />);
  expect(screen.getByText(/pièce jointe au lot CB du 09\/11/)).toBeInTheDocument();
  rerender(<BookingInvoiceBlock {...base} booking={invoiced('failed')} />);
  expect(screen.getByRole('button', { name: 'Choisir la transaction' })).toBeInTheDocument();
  rerender(<BookingInvoiceBlock {...base} booking={invoiced(null, false)} />);
  expect(screen.getByText('Facture F-2026-0142 créée dans Qonto.')).toBeInTheDocument();
  expect(screen.getByText(/Seule la note reste modifiable/)).toBeInTheDocument();
});
