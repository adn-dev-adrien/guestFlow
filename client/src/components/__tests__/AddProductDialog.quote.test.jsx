// specs/pricing-components.md §3 rules 27, 30 — the dialog quotes through the server, shows the total it gives, sells at that price,
// refuses an invalid quantity, and shows a refusal of the server.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ default: { quoteExtraSale: vi.fn(), sellExtra: vi.fn() } }));
import api from '../../api';
import AddProductDialog from '../AddProductDialog';

const articles = [{ articleRef: 'option:5', label: 'Bain nordique' }];
const quote = { totalCents: 4000, lines: [{ momentLabel: 'À payer à l’arrivée', merged: false }] };

beforeEach(() => { vi.clearAllMocks(); api.quoteExtraSale.mockResolvedValue(quote); });

async function pick() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Produit' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Bain nordique' }));
}

test('the server\'s price and moment appear, and the sale carries the accepted total', async () => {
  const onSold = vi.fn();
  api.sellExtra.mockResolvedValue({ saleDetail: { lines: [] } });
  render(<AddProductDialog open onClose={() => {}} reservationId={12} articles={articles} onSold={onSold} />);
  expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
  await pick();
  expect(await screen.findByText('À payer à l’arrivée')).toBeInTheDocument();
  expect(screen.getByText(/40,00/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(api.sellExtra).toHaveBeenCalledWith(12, { requests: [{ articleRef: 'option:5', quantity: 1 }], payment: 'later', acceptedTotalCents: 4000 }));
  expect(onSold).toHaveBeenCalledWith({ lines: [] });
});

test('a quantity of 0 is refused on the field and nothing is asked', async () => {
  render(<AddProductDialog open onClose={() => {}} reservationId={12} articles={articles} onSold={() => {}} />);
  await pick();
  await screen.findByText('À payer à l’arrivée');
  api.quoteExtraSale.mockClear();
  const field = screen.getByLabelText('Quantité');
  await userEvent.clear(field);
  await userEvent.type(field, '0');
  expect(await screen.findByText('Une quantité supérieure à 0.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
  expect(api.quoteExtraSale).not.toHaveBeenCalled();
});

test('a price that moved is shown as the server worded it', async () => {
  api.sellExtra.mockRejectedValue(new Error('Prix modifié — relire le panier.'));
  render(<AddProductDialog open onClose={() => {}} reservationId={12} articles={articles} onSold={() => {}} />);
  await pick();
  await screen.findByText('À payer à l’arrivée');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  expect(await screen.findByText('Prix modifié — relire le panier.')).toBeInTheDocument();
});

test('a second sale of an article says it is a new line and what the stay already holds, as the server wrote it', async () => {
  api.quoteExtraSale.mockResolvedValue({ totalCents: 1300, lines: [{ momentLabel: 'À payer au départ', merged: false, note: 'Déjà vendu sur ce séjour : 1 × 6,50 €. Ces lignes gardent leur prix.' }] });
  render(<AddProductDialog open onClose={() => {}} reservationId={12} articles={articles} onSold={() => {}} />);
  await pick();
  expect(await screen.findByText('Nouvelle ligne')).toBeInTheDocument();
  expect(screen.getByText(/Ces lignes gardent leur prix/)).toBeInTheDocument();
});
