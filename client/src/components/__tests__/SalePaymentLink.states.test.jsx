/**
 * SalePaymentLink — the « Envoyer un lien » block of a sale's reste (specs/outside-booking-sas.md rules 39-42): four states drawn from the server's `paymentLink` payload, a disabled
 * action with « Adresse e-mail requise. » and an « E-mail » field when no address is known, copy on a click, and the e-mail only on its own click.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SalePaymentLink from '../SalePaymentLink';

const link = (over = {}) => ({
  available: true, reason: null, email: 'a@exemple.fr', open: null, ...over,
});
const OPEN = {
  id: 3, url: 'https://pay.exemple.fr/l/abc', amountCents: 1300, expiresAt: '2099-02-14T08:00:00.000Z',
};
const handlers = () => ({ onMint: vi.fn(), onSendEmail: vi.fn(), onWithdraw: vi.fn() });

test('rule 39 — no ready provider (or nothing due): nothing is drawn', () => {
  const { container, rerender } = render(<SalePaymentLink link={link({ available: false, reason: 'PROVIDER_NOT_READY' })} {...handlers()} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<SalePaymentLink link={link({ available: false, reason: 'NOTHING_DUE' })} {...handlers()} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<SalePaymentLink link={null} {...handlers()} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 39 — ready: « Envoyer un lien » is one click, with no address typed', () => {
  const h = handlers();
  render(<SalePaymentLink link={link()} {...h} />);
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer un lien' }));
  expect(h.onMint).toHaveBeenCalledWith(null);
  expect(screen.queryByLabelText('E-mail')).toBeNull();
});

test('rule 39 — no address known: the action is disabled with « Adresse e-mail requise. », a valid address enables it and goes with the click; an invalid one says so', () => {
  const h = handlers();
  render(<SalePaymentLink link={link({ available: false, reason: 'NO_EMAIL', email: null })} {...h} />);
  const action = screen.getByRole('button', { name: 'Envoyer un lien' });
  expect(action).toBeDisabled();
  expect(screen.getByText('Adresse e-mail requise.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pas-une-adresse' } });
  expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument();
  expect(action).toBeDisabled();
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: ' c@exemple.fr ' } });
  expect(action).toBeEnabled();
  fireEvent.click(action);
  expect(h.onMint).toHaveBeenCalledWith('c@exemple.fr');
});

test('rules 40-42 — minted: the amount and the validity are the payload\'s; copying says so; the e-mail leaves only on its own click; the link can be withdrawn', async () => {
  const writeText = vi.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  const h = handlers();
  render(<SalePaymentLink link={link({ open: OPEN })} {...h} sentTo="a@exemple.fr" />);
  expect(screen.getByText(/^Lien · 13,00 € · valable jusqu’au \d{2}\/\d{2} à \d{2}:\d{2}$/)).toBeInTheDocument();
  expect(screen.getByText('https://pay.exemple.fr/l/abc')).toBeInTheDocument();
  expect(h.onSendEmail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copier le lien' }));
  await waitFor(() => expect(screen.getByText('Lien copié.')).toBeInTheDocument());
  expect(writeText).toHaveBeenCalledWith('https://pay.exemple.fr/l/abc');
  expect(h.onSendEmail).not.toHaveBeenCalled();
  expect(screen.getByText('E-mail envoyé à a@exemple.fr.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer par e-mail' }));
  expect(h.onSendEmail).toHaveBeenCalledWith(OPEN);
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le lien' }));
  expect(h.onWithdraw).toHaveBeenCalledWith(OPEN);
});

test('rule 42 — a minted link with no address known cannot be e-mailed; a failed copy says where the link is; the server\'s refusal is shown', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
  render(<SalePaymentLink link={link({ email: null, open: OPEN })} {...handlers()} error="Aucun moyen de paiement en ligne n’est connecté." />);
  expect(screen.getByRole('button', { name: 'Envoyer par e-mail' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Copier le lien' }));
  expect(await screen.findByText('Copie impossible : le lien est affiché ci-dessus.')).toBeInTheDocument();
  expect(screen.getByText('Aucun moyen de paiement en ligne n’est connecté.')).toBeInTheDocument();
});

test('a read-only block cannot mint, send or withdraw', () => {
  const { rerender } = render(<SalePaymentLink link={link()} {...handlers()} disabled />);
  expect(screen.getByRole('button', { name: 'Envoyer un lien' })).toBeDisabled();
  rerender(<SalePaymentLink link={link({ open: OPEN })} {...handlers()} disabled />);
  expect(screen.getByRole('button', { name: 'Envoyer par e-mail' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retirer le lien' })).toBeDisabled();
});
